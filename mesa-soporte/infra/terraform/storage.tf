locals {
  namespace = data.oci_objectstorage_namespace.ns.namespace
}

# Ticket attachments. Versioned: an overwrite or delete keeps the previous
# version for var.attachments_retention_days.
resource "oci_objectstorage_bucket" "attachments" {
  compartment_id        = oci_identity_compartment.mesa.id
  namespace             = local.namespace
  name                  = "adjuntos"
  access_type           = "NoPublicAccess"
  storage_tier          = "Standard"
  versioning            = "Enabled"
  kms_key_id            = oci_kms_key.master.id
  object_events_enabled = true
  freeform_tags         = local.tags
  depends_on            = [oci_identity_policy.services]
}

# pgBackRest repository (continuous WAL + full/differential backups).
resource "oci_objectstorage_bucket" "pitr" {
  compartment_id = oci_identity_compartment.mesa.id
  namespace      = local.namespace
  name           = "respaldos-pitr"
  access_type    = "NoPublicAccess"
  storage_tier   = "Standard"
  versioning     = "Enabled"
  kms_key_id     = oci_kms_key.master.id
  freeform_tags  = local.tags
  depends_on     = [oci_identity_policy.services]
}

# Daily age-encrypted dumps. The retention rule is created UNLOCKED; lock it
# by hand after the first successful restore test (docs/despliegue.md). Once
# locked, nobody (not even tenancy administrators) can delete objects early.
resource "oci_objectstorage_bucket" "immutable" {
  compartment_id = oci_identity_compartment.mesa.id
  namespace      = local.namespace
  name           = "respaldos-inmutables"
  access_type    = "NoPublicAccess"
  storage_tier   = "Standard"
  versioning     = "Disabled"
  kms_key_id     = oci_kms_key.master.id

  retention_rules {
    display_name = "worm-${var.immutable_retention_days}d"
    duration {
      time_amount = var.immutable_retention_days
      time_unit   = "DAYS"
    }
  }
  freeform_tags = local.tags
  depends_on    = [oci_identity_policy.services]

  lifecycle {
    # Locking happens outside Terraform; do not fight it.
    ignore_changes = [retention_rules]
  }
}

resource "oci_objectstorage_object_lifecycle_policy" "attachments" {
  namespace = local.namespace
  bucket    = oci_objectstorage_bucket.attachments.name
  rules {
    name        = "purge-previous-versions"
    action      = "DELETE"
    target      = "previous-object-versions"
    is_enabled  = true
    time_amount = var.attachments_retention_days
    time_unit   = "DAYS"
  }
}

resource "oci_objectstorage_object_lifecycle_policy" "pitr" {
  namespace = local.namespace
  bucket    = oci_objectstorage_bucket.pitr.name
  rules {
    name        = "purge-previous-versions"
    action      = "DELETE"
    target      = "previous-object-versions"
    is_enabled  = true
    time_amount = 14
    time_unit   = "DAYS"
  }
}

resource "oci_objectstorage_object_lifecycle_policy" "immutable" {
  namespace = local.namespace
  bucket    = oci_objectstorage_bucket.immutable.name
  rules {
    name        = "expire-dumps"
    action      = "DELETE"
    target      = "objects"
    is_enabled  = true
    time_amount = var.immutable_delete_after_days
    time_unit   = "DAYS"
    object_name_filter {
      inclusion_prefixes = ["pgdump/"]
    }
  }
  lifecycle {
    precondition {
      condition     = var.immutable_delete_after_days > var.immutable_retention_days
      error_message = "immutable_delete_after_days must be greater than immutable_retention_days."
    }
  }
}
