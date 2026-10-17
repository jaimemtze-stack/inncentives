variable "tenancy_ocid" {
  description = "OCID of the tenancy (root compartment)."
  type        = string
}

variable "parent_compartment_ocid" {
  description = "Compartment under which the 'mesa-soporte' compartment is created (usually the tenancy)."
  type        = string
}

variable "region" {
  description = "Home region of the tenancy. Data must stay in Mexico."
  type        = string
  default     = "mx-queretaro-1"
  validation {
    condition     = contains(["mx-queretaro-1", "mx-monterrey-1"], var.region)
    error_message = "Only the Mexican regions are allowed (Querétaro or Monterrey)."
  }
}

variable "environment" {
  description = "Environment name (prod or staging)."
  type        = string
  default     = "prod"
  validation {
    condition     = contains(["prod", "staging"], var.environment)
    error_message = "environment must be prod or staging."
  }
}

variable "availability_domain_index" {
  description = "Availability domain to use (Mexican regions have a single AD)."
  type        = number
  default     = 0
}

variable "instance_ocpus" {
  description = "Ampere A1 OCPUs. 2 stays within the Always Free allowance."
  type        = number
  default     = 2
}

variable "instance_memory_gbs" {
  description = "Ampere A1 memory. 12 GB stays within the Always Free allowance."
  type        = number
  default     = 12
}

variable "boot_volume_gbs" {
  description = "Boot volume size. Boot + data volumes must stay <= 200 GB to remain free."
  type        = number
  default     = 50
}

variable "data_volume_gbs" {
  description = "Block volume for PostgreSQL, Redis and ClamAV data."
  type        = number
  default     = 100
}

variable "image_ocid" {
  description = "Optional Ubuntu 24.04 aarch64 image OCID. Empty = latest Canonical image."
  type        = string
  default     = ""
}

variable "vcn_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "private_subnet_cidr" {
  type    = string
  default = "10.40.1.0/24"
}

variable "bastion_allowed_cidrs" {
  description = "Public CIDRs allowed to open OCI Bastion sessions (emergency access only)."
  type        = list(string)
  validation {
    condition     = length(var.bastion_allowed_cidrs) > 0 && !contains(var.bastion_allowed_cidrs, "0.0.0.0/0")
    error_message = "List the office/VPN egress IPs; 0.0.0.0/0 is not allowed."
  }
}

variable "alert_emails" {
  description = "Recipients of operational alarms (for example the e-mail address of the Teams channel)."
  type        = list(string)
}

variable "budget_monthly_usd" {
  description = "Monthly budget for the compartment. Alerts at 50/80/100 %."
  type        = number
}

variable "budget_alert_emails" {
  description = "Recipients of budget alerts."
  type        = list(string)
}

variable "attachments_retention_days" {
  description = "Delete non-current versions of attachment objects after this many days."
  type        = number
  default     = 14
}

variable "immutable_retention_days" {
  description = "Retention rule (WORM) of the immutable backup bucket."
  type        = number
  default     = 30
}

variable "immutable_delete_after_days" {
  description = "Lifecycle deletion of immutable backups (must be > immutable_retention_days)."
  type        = number
  default     = 90
}

variable "enable_cloud_guard_target" {
  description = "Create a Cloud Guard target for the compartment (Cloud Guard must already be enabled in the tenancy)."
  type        = bool
  default     = true
}

variable "enable_security_zone" {
  description = "Place the compartment in a Security Zone with the Oracle maximum-security recipe."
  type        = bool
  default     = true
}

variable "github_repository" {
  description = "owner/repo that publishes the signed releases (used by the deployer on the VM)."
  type        = string
}

variable "public_hosts" {
  description = "Public host names served through Cloudflare."
  type = object({
    portal = string
    agent  = string
  })
}

variable "mail_from" {
  description = "Sender of system e-mails, e.g. 'Soporte Inncentives <soporte@inncentives.com>'."
  type        = string
}
