locals {
  name = "mesa-${var.environment}"
  tags = {
    "app"         = "mesa-soporte"
    "environment" = var.environment
    "managed-by"  = "terraform"
  }
  ad = data.oci_identity_availability_domains.ads.availability_domains[var.availability_domain_index].name
}

data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

data "oci_objectstorage_namespace" "ns" {
  compartment_id = var.tenancy_ocid
}

resource "oci_identity_compartment" "mesa" {
  compartment_id = var.parent_compartment_ocid
  name           = "mesa-soporte-${var.environment}"
  description    = "Mesa de soporte de Inncentives (${var.environment})"
  enable_delete  = false
  freeform_tags  = local.tags
}
