output "compartment_id" {
  value = oci_identity_compartment.mesa.id
}

output "instance_id" {
  value = oci_core_instance.app.id
}

output "instance_private_ip" {
  value = oci_core_instance.app.private_ip
}

output "object_storage_namespace" {
  value = local.namespace
}

output "vault_id" {
  value = oci_kms_vault.main.id
}

output "master_key_id" {
  value = oci_kms_key.master.id
}

output "bastion_id" {
  value = oci_bastion_bastion.main.id
}

output "pgbackrest_user_id" {
  description = "Create its Customer Secret Key by hand (never in Terraform state)."
  value       = oci_identity_user.pgbackrest.id
}

output "pgbackrest_s3_endpoint" {
  value = "${local.namespace}.compat.objectstorage.${var.region}.oraclecloud.com"
}

output "alerts_topic_id" {
  value = oci_ons_notification_topic.alerts.id
}
