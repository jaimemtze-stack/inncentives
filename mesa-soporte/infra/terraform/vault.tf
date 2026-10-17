# DEFAULT vault (shared HSM partition): within the Always Free allowance of
# 20 HSM key versions and 150 secrets. Secret VALUES are never created by
# Terraform (they would end up in the state): see infra/scripts/bootstrap-secrets.sh.
resource "oci_kms_vault" "main" {
  compartment_id = oci_identity_compartment.mesa.id
  display_name   = "${local.name}-vault"
  vault_type     = "DEFAULT"
  freeform_tags  = local.tags
}

resource "oci_kms_key" "master" {
  compartment_id      = oci_identity_compartment.mesa.id
  display_name        = "${local.name}-master-key"
  management_endpoint = oci_kms_vault.main.management_endpoint
  protection_mode     = "HSM"
  key_shape {
    algorithm = "AES"
    length    = 32
  }
  freeform_tags = local.tags
}
