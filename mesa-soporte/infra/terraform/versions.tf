terraform {
  required_version = ">= 1.12.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 9.10"
    }
  }

  # Remote state in an OCI bucket with versioning (see backend.hcl.example).
  # Initialise with: terraform init -backend-config=backend.hcl
  backend "oci" {}
}

provider "oci" {
  region = var.region
}
