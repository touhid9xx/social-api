"""Developer scripts package.

Not part of the deployed app — but making this a package allows
cross-imports between scripts (e.g. check_api_contract_drift imports
_write_markdown from export_api_contract) without sys.path hacks.
"""
