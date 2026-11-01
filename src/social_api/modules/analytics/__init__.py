"""Aggregate visit analytics + optional GeoLite2 enrichment.

Two rules govern this package and must not be weakened:

1. **No identifiers are persisted.** A row in `analytics_visit` describes a
   single request (class, status, latency, coarse geo) and nothing that can
   be traced back to a person. There is no user id, session id, IP, user
   agent or referrer column — by design, not by oversight.
2. **Consent gates signed-in traffic.** `ConsentChannel.ANALYTICS` is
   checked at flush time (one batched query, never per request); events
   from users who have not granted it are dropped before they hit the DB.

Unique-visitor counts are *estimates* kept in Redis HyperLogLog sets keyed
per day, fed with a salted one-way hash that is never stored.
"""
