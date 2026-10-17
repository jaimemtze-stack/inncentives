# Cloud Guard posture monitoring on the compartment (Cloud Guard itself is a
# tenancy-level setting, normally already enabled by the tenancy admins).
data "oci_cloud_guard_detector_recipes" "config" {
  compartment_id = var.tenancy_ocid
  display_name   = "OCI Configuration Detector Recipe"
}

data "oci_cloud_guard_detector_recipes" "activity" {
  compartment_id = var.tenancy_ocid
  display_name   = "OCI Activity Detector Recipe"
}

data "oci_cloud_guard_responder_recipes" "notify" {
  compartment_id = var.tenancy_ocid
  display_name   = "OCI Responder Recipe"
}

resource "oci_cloud_guard_target" "mesa" {
  count                = var.enable_cloud_guard_target ? 1 : 0
  compartment_id       = oci_identity_compartment.mesa.id
  display_name         = "${local.name}-cloud-guard"
  target_resource_id   = oci_identity_compartment.mesa.id
  target_resource_type = "COMPARTMENT"

  target_detector_recipes {
    detector_recipe_id = data.oci_cloud_guard_detector_recipes.config.detector_recipe_collection[0].items[0].id
  }
  target_detector_recipes {
    detector_recipe_id = data.oci_cloud_guard_detector_recipes.activity.detector_recipe_collection[0].items[0].id
  }
  target_responder_recipes {
    responder_recipe_id = data.oci_cloud_guard_responder_recipes.notify.responder_recipe_collection[0].items[0].id
  }
  freeform_tags = local.tags
}

# Security Zone: Oracle's maximum-security recipe prevents public buckets,
# public IPs, unencrypted volumes and similar drift inside the compartment.
data "oci_cloud_guard_security_recipes" "max" {
  compartment_id = var.tenancy_ocid
}

locals {
  max_security_recipes = [
    for r in try(data.oci_cloud_guard_security_recipes.max.security_recipe_collection[0].items, []) :
    r.id if length(regexall("^Maximum Security Recipe", r.display_name)) > 0
  ]
}

resource "oci_cloud_guard_security_zone" "mesa" {
  count                   = var.enable_security_zone ? 1 : 0
  compartment_id          = oci_identity_compartment.mesa.id
  display_name            = "${local.name}-security-zone"
  security_zone_recipe_id = local.max_security_recipes[0]
  freeform_tags           = local.tags
}

# Weekly host vulnerability scans with the OCI agent (no extra cost).
resource "oci_vulnerability_scanning_host_scan_recipe" "weekly" {
  compartment_id = oci_identity_compartment.mesa.id
  display_name   = "${local.name}-host-scan"

  agent_settings {
    scan_level = "STANDARD"
    agent_configuration {
      vendor = "OCI"
    }
  }
  port_settings {
    scan_level = "STANDARD"
  }
  schedule {
    type        = "WEEKLY"
    day_of_week = "SUNDAY"
  }
  freeform_tags = local.tags
}

resource "oci_vulnerability_scanning_host_scan_target" "mesa" {
  compartment_id        = oci_identity_compartment.mesa.id
  display_name          = "${local.name}-host-scan-target"
  host_scan_recipe_id   = oci_vulnerability_scanning_host_scan_recipe.weekly.id
  target_compartment_id = oci_identity_compartment.mesa.id
  freeform_tags         = local.tags
}
