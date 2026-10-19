locals {
  comp = "compartment id ${oci_identity_compartment.mesa.id}"
}

# The VM identity (instance principal). No API keys exist on the server.
resource "oci_identity_dynamic_group" "vm" {
  compartment_id = var.tenancy_ocid
  name           = "${local.name}-vm"
  description    = "Instance principal of the mesa-soporte VM"
  matching_rule  = "ANY {instance.id = '${oci_core_instance.app.id}'}"
  freeform_tags  = local.tags
}

resource "oci_identity_policy" "vm" {
  compartment_id = oci_identity_compartment.mesa.id
  name           = "${local.name}-vm"
  description    = "Least privilege for the mesa-soporte VM"
  statements = [
    # Secrets: read only, only this vault.
    "Allow dynamic-group ${oci_identity_dynamic_group.vm.name} to read secret-bundles in ${local.comp} where target.vault.id = '${oci_kms_vault.main.id}'",
    # Attachments: object CRUD + read-only PARs, only in this bucket.
    "Allow dynamic-group ${oci_identity_dynamic_group.vm.name} to read buckets in ${local.comp} where target.bucket.name = 'adjuntos'",
    "Allow dynamic-group ${oci_identity_dynamic_group.vm.name} to manage objects in ${local.comp} where all {target.bucket.name = 'adjuntos', any {request.permission = 'OBJECT_CREATE', request.permission = 'OBJECT_READ', request.permission = 'OBJECT_INSPECT', request.permission = 'OBJECT_DELETE'}}",
    "Allow dynamic-group ${oci_identity_dynamic_group.vm.name} to manage buckets in ${local.comp} where all {target.bucket.name = 'adjuntos', request.permission = 'PAR_MANAGE'}",
    # Immutable dumps: create only (no read, overwrite or delete).
    "Allow dynamic-group ${oci_identity_dynamic_group.vm.name} to manage objects in ${local.comp} where all {target.bucket.name = 'respaldos-inmutables', any {request.permission = 'OBJECT_CREATE', request.permission = 'OBJECT_INSPECT'}}",
    # Observability.
    "Allow dynamic-group ${oci_identity_dynamic_group.vm.name} to use log-content in ${local.comp}",
    "Allow dynamic-group ${oci_identity_dynamic_group.vm.name} to use metrics in ${local.comp} where target.metrics.namespace = 'mesa'",
    "Allow dynamic-group ${oci_identity_dynamic_group.vm.name} to use ons-topics in ${local.comp} where target.topic.id = '${oci_ons_notification_topic.alerts.id}'",
  ]
  freeform_tags = local.tags
}

# Service principals that need the master key and lifecycle management.
resource "oci_identity_policy" "services" {
  compartment_id = oci_identity_compartment.mesa.id
  name           = "${local.name}-services"
  description    = "Oracle services using the compartment key and lifecycle rules"
  statements = [
    "Allow service objectstorage-${var.region} to use keys in ${local.comp} where target.key.id = '${oci_kms_key.master.id}'",
    "Allow service blockstorage to use keys in ${local.comp} where target.key.id = '${oci_kms_key.master.id}'",
    "Allow service objectstorage-${var.region} to manage object-family in ${local.comp}",
  ]
  freeform_tags = local.tags
}

# pgBackRest speaks the S3-compatible API, which needs a Customer Secret Key.
# This user can only touch the PITR bucket. The key is created by hand and
# rotated every 90 days (docs/runbooks/rotacion-secretos.md).
resource "oci_identity_user" "pgbackrest" {
  compartment_id = var.tenancy_ocid
  name           = "svc-${local.name}-pgbackrest"
  description    = "pgBackRest S3-compatible access to respaldos-pitr only"
  # Identity domains require a primary e-mail, even for service users.
  email         = var.service_user_email != "" ? var.service_user_email : var.alert_emails[0]
  freeform_tags = local.tags
}

resource "oci_identity_user_capabilities_management" "pgbackrest" {
  user_id                      = oci_identity_user.pgbackrest.id
  can_use_api_keys             = false
  can_use_auth_tokens          = false
  can_use_console_password     = false
  can_use_customer_secret_keys = true
  can_use_smtp_credentials     = false
}

resource "oci_identity_group" "pgbackrest" {
  compartment_id = var.tenancy_ocid
  name           = "${local.name}-pgbackrest"
  description    = "Service group for pgBackRest"
  freeform_tags  = local.tags
}

resource "oci_identity_user_group_membership" "pgbackrest" {
  group_id = oci_identity_group.pgbackrest.id
  user_id  = oci_identity_user.pgbackrest.id
}

resource "oci_identity_policy" "pgbackrest" {
  compartment_id = oci_identity_compartment.mesa.id
  name           = "${local.name}-pgbackrest"
  description    = "pgBackRest repository access"
  statements = [
    "Allow group ${oci_identity_group.pgbackrest.name} to read buckets in ${local.comp} where target.bucket.name = 'respaldos-pitr'",
    "Allow group ${oci_identity_group.pgbackrest.name} to manage objects in ${local.comp} where target.bucket.name = 'respaldos-pitr'",
  ]
  freeform_tags = local.tags
}

# Human access. Map these groups to Microsoft Entra ID groups through identity
# federation (docs/despliegue.md); nobody gets local OCI passwords.
resource "oci_identity_group" "infra" {
  compartment_id = var.tenancy_ocid
  name           = "${local.name}-infra"
  description    = "Operators of the mesa-soporte infrastructure (Entra: SG-Soporte-Infra)"
  freeform_tags  = local.tags
}

resource "oci_identity_group" "audit" {
  compartment_id = var.tenancy_ocid
  name           = "${local.name}-auditoria"
  description    = "Read-only auditors (Entra: SG-Soporte-Auditoria)"
  freeform_tags  = local.tags
}

resource "oci_identity_policy" "humans" {
  compartment_id = oci_identity_compartment.mesa.id
  name           = "${local.name}-humans"
  description    = "Operator and auditor access"
  statements = [
    "Allow group ${oci_identity_group.infra.name} to manage all-resources in ${local.comp}",
    "Allow group ${oci_identity_group.infra.name} to manage bastion-session in ${local.comp}",
    "Allow group ${oci_identity_group.audit.name} to read all-resources in ${local.comp}",
  ]
  freeform_tags = local.tags
}
