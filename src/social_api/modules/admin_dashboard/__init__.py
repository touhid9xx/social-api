"""Admin dashboard aggregates — admin-only, read-only, single round trip.

Consumes `analytics_visit` (see `modules/analytics`) plus the existing
operational tables. Emits no PII beyond a display name on the top storage
consumers, and nothing that links two visits to the same person.
"""
