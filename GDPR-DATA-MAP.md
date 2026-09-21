# PCF BATTLE GDPR data map

This document describes the data currently represented by the application. It
is an implementation map, not legal advice or a substitute for the controller's
record of processing activities.

| Data | Purpose | Access | Retention decision required |
|---|---|---|---|
| Team name, contact person, email, phone and address | Registration and tournament coordination | Admin; relevant team users | Define period after the tournament |
| Delegation names, roles, numbers and dietary information | Match, accommodation and catering operations | Admin; the relevant team | Define event + post-event period |
| Consent flags and photos | Consent management and public presentation | Admin; public only when published | Delete when consent/purpose ends |
| Referee and official accounts | Authentication and match assignments | Admin; assigned officials | Disable promptly after the event |
| Room assignments and payments | Accommodation and financial administration | Admin; relevant team | Align with Belgian accounting obligations |
| Messages and invitations | Operational communication and portal access | Sender, recipient and admin | Define operational retention period |
| Audit records | Security, accountability and tournament recovery | Admin only | Define security-log retention period |
| Uploaded media and documents | Tournament content and administration | Based on file type and owner policy | Delete when purpose ends |
| Analytics identifiers | Aggregate website measurement | Analytics provider after consent | Provider retention settings must be reviewed |

## Required operational decisions

The organisation must document the controller identity, purposes, legal bases,
processors, international transfers, retention periods, deletion process and
data-subject request workflow. Automatic deletion should only be implemented
after these periods are approved, because tournament and accounting needs can
conflict with immediate deletion.

## Current technical safeguards

- Analytics is loaded only after cookie consent.
- Passwords are hashed and sessions use an HttpOnly, Secure, SameSite cookie.
- Normal public API lists remove password fields.
- Private PDF downloads require the owner or an administrator.
- Team, referee and administrator permissions are checked server-side.
- Important changes are written to the audit log.
