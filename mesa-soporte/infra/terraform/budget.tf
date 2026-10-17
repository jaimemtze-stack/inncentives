resource "oci_budget_budget" "mesa" {
  compartment_id = var.tenancy_ocid
  display_name   = "${local.name}-budget"
  description    = "Monthly budget of the support desk"
  amount         = var.budget_monthly_usd
  reset_period   = "MONTHLY"
  target_type    = "COMPARTMENT"
  targets        = [oci_identity_compartment.mesa.id]
  freeform_tags  = local.tags
}

resource "oci_budget_alert_rule" "thresholds" {
  for_each       = toset(["50", "80", "100"])
  budget_id      = oci_budget_budget.mesa.id
  display_name   = "${local.name}-budget-${each.value}"
  type           = "ACTUAL"
  threshold      = tonumber(each.value)
  threshold_type = "PERCENTAGE"
  recipients     = join(",", var.budget_alert_emails)
  message        = "The support desk compartment reached ${each.value}% of its monthly budget."
}

# Forecast alert: warns before the month ends if spending trends above budget.
resource "oci_budget_alert_rule" "forecast" {
  budget_id      = oci_budget_budget.mesa.id
  display_name   = "${local.name}-budget-forecast"
  type           = "FORECAST"
  threshold      = 100
  threshold_type = "PERCENTAGE"
  recipients     = join(",", var.budget_alert_emails)
  message        = "Forecast: the support desk will exceed its monthly budget."
}
