data "oci_core_services" "all" {
  filter {
    name   = "name"
    values = ["All .* Services In Oracle Services Network"]
    regex  = true
  }
}

resource "oci_core_vcn" "main" {
  compartment_id = oci_identity_compartment.mesa.id
  cidr_blocks    = [var.vcn_cidr]
  display_name   = "${local.name}-vcn"
  dns_label      = "mesa${var.environment}"
  freeform_tags  = local.tags
}

# Replace the default security list (which allows SSH from anywhere) with an
# empty one: traffic is governed only by the NSG below.
resource "oci_core_default_security_list" "default" {
  manage_default_resource_id = oci_core_vcn.main.default_security_list_id
  display_name               = "${local.name}-default-deny"
  freeform_tags              = local.tags
}

resource "oci_core_nat_gateway" "nat" {
  compartment_id = oci_identity_compartment.mesa.id
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${local.name}-nat"
  freeform_tags  = local.tags
}

resource "oci_core_service_gateway" "sgw" {
  compartment_id = oci_identity_compartment.mesa.id
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${local.name}-sgw"
  services {
    service_id = data.oci_core_services.all.services[0].id
  }
  freeform_tags = local.tags
}

resource "oci_core_route_table" "private" {
  compartment_id = oci_identity_compartment.mesa.id
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${local.name}-private-rt"

  # Object Storage, Vault, Logging, Monitoring… stay on the Oracle network.
  route_rules {
    destination       = data.oci_core_services.all.services[0].cidr_block
    destination_type  = "SERVICE_CIDR_BLOCK"
    network_entity_id = oci_core_service_gateway.sgw.id
  }
  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_nat_gateway.nat.id
  }
  freeform_tags = local.tags
}

resource "oci_core_subnet" "private" {
  compartment_id             = oci_identity_compartment.mesa.id
  vcn_id                     = oci_core_vcn.main.id
  cidr_block                 = var.private_subnet_cidr
  display_name               = "${local.name}-private"
  dns_label                  = "app"
  prohibit_public_ip_on_vnic = true
  prohibit_internet_ingress  = true
  route_table_id             = oci_core_route_table.private.id
  security_list_ids          = [oci_core_vcn.main.default_security_list_id]
  freeform_tags              = local.tags
}

resource "oci_core_network_security_group" "app" {
  compartment_id = oci_identity_compartment.mesa.id
  vcn_id         = oci_core_vcn.main.id
  display_name   = "${local.name}-app-nsg"
  freeform_tags  = local.tags
}

# Inbound: only SSH from OCI Bastion sessions (inside the subnet). Web traffic
# arrives through the outbound Cloudflare Tunnel, never through an open port.
resource "oci_core_network_security_group_security_rule" "ssh_from_bastion" {
  network_security_group_id = oci_core_network_security_group.app.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source_type               = "CIDR_BLOCK"
  source                    = var.private_subnet_cidr
  description               = "SSH from OCI Bastion managed sessions"
  tcp_options {
    destination_port_range {
      min = 22
      max = 22
    }
  }
}

locals {
  egress_rules = {
    https           = { protocol = "6", port = 443, description = "HTTPS (Cloudflare, Microsoft Graph, GitHub, sigstore, package mirrors)" }
    apt_http        = { protocol = "6", port = 80, description = "Ubuntu package mirrors (plain HTTP; packages are GPG-signed)" }
    cloudflared_tcp = { protocol = "6", port = 7844, description = "Cloudflare Tunnel (TCP)" }
    cloudflared_udp = { protocol = "17", port = 7844, description = "Cloudflare Tunnel (QUIC)" }
    smtp_submission = { protocol = "6", port = 587, description = "SMTP submission with STARTTLS (Microsoft 365)" }
    imaps           = { protocol = "6", port = 993, description = "IMAP over TLS (alternative mailbox adapter)" }
    dns_udp         = { protocol = "17", port = 53, description = "DNS" }
    ntp             = { protocol = "17", port = 123, description = "NTP" }
  }
}

resource "oci_core_network_security_group_security_rule" "egress" {
  for_each                  = local.egress_rules
  network_security_group_id = oci_core_network_security_group.app.id
  direction                 = "EGRESS"
  protocol                  = each.value.protocol
  destination_type          = "CIDR_BLOCK"
  destination               = "0.0.0.0/0"
  description               = each.value.description

  dynamic "tcp_options" {
    for_each = each.value.protocol == "6" ? [1] : []
    content {
      destination_port_range {
        min = each.value.port
        max = each.value.port
      }
    }
  }
  dynamic "udp_options" {
    for_each = each.value.protocol == "17" ? [1] : []
    content {
      destination_port_range {
        min = each.value.port
        max = each.value.port
      }
    }
  }
}

resource "oci_core_network_security_group_security_rule" "egress_oracle_services" {
  network_security_group_id = oci_core_network_security_group.app.id
  direction                 = "EGRESS"
  protocol                  = "6"
  destination_type          = "SERVICE_CIDR_BLOCK"
  destination               = data.oci_core_services.all.services[0].cidr_block
  description               = "Oracle services through the Service Gateway"
}
