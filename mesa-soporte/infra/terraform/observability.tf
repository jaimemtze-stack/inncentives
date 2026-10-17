resource "oci_ons_notification_topic" "alerts" {
  compartment_id = oci_identity_compartment.mesa.id
  name           = "${local.name}-alerts"
  description    = "Operational alarms of the support desk"
  freeform_tags  = local.tags
}

resource "oci_ons_subscription" "alerts" {
  for_each       = toset(var.alert_emails)
  compartment_id = oci_identity_compartment.mesa.id
  topic_id       = oci_ons_notification_topic.alerts.id
  protocol       = "EMAIL"
  endpoint       = each.value
}

locals {
  alarms = {
    cpu = {
      namespace = "oci_computeagent"
      query     = "CpuUtilization[5m]{resourceId = \"${oci_core_instance.app.id}\"}.mean() > 85"
      severity  = "WARNING"
      body      = "CPU above 85% for 5 minutes on the support desk VM."
    }
    memory = {
      namespace = "oci_computeagent"
      query     = "MemoryUtilization[5m]{resourceId = \"${oci_core_instance.app.id}\"}.mean() > 90"
      severity  = "CRITICAL"
      body      = "Memory above 90% on the support desk VM."
    }
    disk = {
      namespace = "mesa"
      query     = "disk_used_percent[10m].max() > 85"
      severity  = "CRITICAL"
      body      = "A data filesystem is above 85%."
    }
    backup_failed = {
      namespace = "mesa"
      query     = "backup_ok[1h].min() < 1"
      severity  = "CRITICAL"
      body      = "A backup or archive check failed (pgBackRest / immutable dump)."
    }
    heartbeat_missing = {
      namespace = "mesa"
      query     = "heartbeat[15m].absent()"
      severity  = "CRITICAL"
      body      = "No heartbeat from the support desk VM for 15 minutes (VM down or agent broken)."
    }
    app_unhealthy = {
      namespace = "mesa"
      query     = "app_healthy[5m].min() < 1"
      severity  = "CRITICAL"
      body      = "The API health check is failing."
    }
  }
}

resource "oci_monitoring_alarm" "this" {
  for_each                     = local.alarms
  compartment_id               = oci_identity_compartment.mesa.id
  metric_compartment_id        = oci_identity_compartment.mesa.id
  display_name                 = "${local.name}-${each.key}"
  namespace                    = each.value.namespace
  query                        = each.value.query
  severity                     = each.value.severity
  body                         = each.value.body
  destinations                 = [oci_ons_notification_topic.alerts.id]
  is_enabled                   = true
  pending_duration             = "PT5M"
  repeat_notification_duration = "PT4H"
  message_format               = "ONS_OPTIMIZED"
  freeform_tags                = local.tags
}

resource "oci_logging_log_group" "main" {
  compartment_id = oci_identity_compartment.mesa.id
  display_name   = "${local.name}-logs"
  description    = "Operating system and operation script logs (no personal data)"
  freeform_tags  = local.tags
}

resource "oci_logging_log" "host" {
  display_name       = "${local.name}-host"
  log_group_id       = oci_logging_log_group.main.id
  log_type           = "CUSTOM"
  is_enabled         = true
  retention_duration = 90
  freeform_tags      = local.tags
}

resource "oci_logging_unified_agent_configuration" "host" {
  compartment_id = oci_identity_compartment.mesa.id
  display_name   = "${local.name}-host-logs"
  description    = "Ships syslog, auth and operation logs"
  is_enabled     = true

  service_configuration {
    configuration_type = "LOGGING"
    destination {
      log_object_id = oci_logging_log.host.id
    }
    sources {
      source_type = "LOG_TAIL"
      name        = "host"
      paths       = ["/var/log/syslog", "/var/log/auth.log", "/var/log/mesa/*.log"]
      parser {
        parser_type = "NONE"
      }
    }
  }

  group_association {
    group_list = [oci_identity_dynamic_group.vm.id]
  }
  freeform_tags = local.tags
}

# OCI Audit records every control-plane change (365-day retention is the
# tenancy default; it is a tenancy-wide setting and is not managed here).
