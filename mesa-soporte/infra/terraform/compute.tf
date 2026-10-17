data "oci_core_images" "ubuntu" {
  compartment_id           = var.tenancy_ocid
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "24.04"
  shape                    = "VM.Standard.A1.Flex"
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

locals {
  image_id   = var.image_ocid != "" ? var.image_ocid : data.oci_core_images.ubuntu.images[0].id
  deploy_dir = "${path.module}/../../deploy"

  # Operation scripts, systemd units and the compose file travel inside the
  # (gzip-compressed) user data: the VM never downloads code at boot.
  bundle = merge(
    { for f in fileset(local.deploy_dir, "scripts/*.sh") :
    "/opt/mesa/${f}" => { b64 = base64encode(file("${local.deploy_dir}/${f}")), mode = endswith(f, "lib.sh") ? "0644" : "0755" } },
    { for f in fileset(local.deploy_dir, "systemd/*") :
    "/etc/systemd/system/${basename(f)}" => { b64 = base64encode(file("${local.deploy_dir}/${f}")), mode = "0644" } },
    { "/opt/mesa/docker-compose.prod.yml" = { b64 = base64encode(file("${local.deploy_dir}/docker-compose.prod.yml")), mode = "0644" } },
  )
}

resource "oci_core_instance" "app" {
  compartment_id      = oci_identity_compartment.mesa.id
  availability_domain = local.ad
  display_name        = "${local.name}-app"
  shape               = "VM.Standard.A1.Flex"

  shape_config {
    ocpus         = var.instance_ocpus
    memory_in_gbs = var.instance_memory_gbs
  }

  source_details {
    source_type             = "image"
    source_id               = local.image_id
    boot_volume_size_in_gbs = var.boot_volume_gbs
    kms_key_id              = oci_kms_key.master.id
  }

  create_vnic_details {
    subnet_id                 = oci_core_subnet.private.id
    assign_public_ip          = false
    assign_private_dns_record = true
    hostname_label            = "app"
    nsg_ids                   = [oci_core_network_security_group.app.id]
  }

  instance_options {
    # IMDSv2 only: metadata requests need the "Authorization: Bearer Oracle" header.
    are_legacy_imds_endpoints_disabled = true
  }

  launch_options {
    is_pv_encryption_in_transit_enabled = true
  }

  agent_config {
    are_all_plugins_disabled = false
    is_management_disabled   = false
    is_monitoring_disabled   = false
    plugins_config {
      name          = "Bastion"
      desired_state = "ENABLED"
    }
    plugins_config {
      name          = "Vulnerability Scanning"
      desired_state = "ENABLED"
    }
    plugins_config {
      name          = "Custom Logs Monitoring"
      desired_state = "ENABLED"
    }
    plugins_config {
      name          = "Compute Instance Monitoring"
      desired_state = "ENABLED"
    }
  }

  metadata = {
    user_data = base64gzip(templatefile("${path.module}/../cloud-init/user-data.yaml.tftpl", {
      bundle            = local.bundle
      github_repository = var.github_repository
      portal_host       = var.public_hosts.portal
      agent_host        = var.public_hosts.agent
      oci_region        = var.region
      oci_namespace     = local.namespace
      mail_from         = var.mail_from
      alerts_topic_id   = oci_ons_notification_topic.alerts.id
      compartment_id    = oci_identity_compartment.mesa.id
    }))
  }

  freeform_tags = local.tags

  lifecycle {
    # A new image does not replace the running server; rebuilds are deliberate.
    ignore_changes = [source_details[0].source_id, metadata]
  }
}

resource "oci_core_volume" "data" {
  compartment_id      = oci_identity_compartment.mesa.id
  availability_domain = local.ad
  display_name        = "${local.name}-data"
  size_in_gbs         = var.data_volume_gbs
  vpus_per_gb         = 10
  kms_key_id          = oci_kms_key.master.id
  freeform_tags       = local.tags
  depends_on          = [oci_identity_policy.services]

  lifecycle {
    prevent_destroy = true
  }
}

resource "oci_core_volume_attachment" "data" {
  attachment_type                     = "paravirtualized"
  instance_id                         = oci_core_instance.app.id
  volume_id                           = oci_core_volume.data.id
  device                              = "/dev/oracleoci/oraclevdb"
  is_pv_encryption_in_transit_enabled = true
}

# No Oracle volume-backup policy: it would exceed the 5 free volume backups.
# Data protection relies on pgBackRest + immutable dumps in Object Storage.

resource "oci_bastion_bastion" "main" {
  bastion_type                 = "STANDARD"
  compartment_id               = oci_identity_compartment.mesa.id
  target_subnet_id             = oci_core_subnet.private.id
  name                         = "${local.name}-bastion"
  client_cidr_block_allow_list = var.bastion_allowed_cidrs
  max_session_ttl_in_seconds   = 10800
  freeform_tags                = local.tags
}
