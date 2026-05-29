+++
title = "SQLite is All You Need for Durable Workflows"
date = 2026-05-29
+++

DBOS recently argued that
<a target="_blank" href="https://www.dbos.dev/blog/postgres-is-all-you-need-for-durable-execution">Postgres
is all you need for durable execution</a>: if you already trust your database, you do not need a
separate orchestration tier. I agree with the direction, and I think the idea can be pushed further.

For a large class of durable systems, SQLite is all you need.

<!-- more -->

![Diagram showing many Obelisk workers writing SQLite state, Litestream backing it up to S3, and an
observer pulling interesting databases for inspection](/blog/2026-05-29-sqlite-is-all-you-need/architecture.svg)

## The Durable Part

Durable execution is often discussed as if it requires durable infrastructure. In many cases it does
not. The durable part is the workflow state. The compute can stay cheap and disposable.

That is a natural fit for Obelisk: workflow progress lives in an execution log, workflows replay
from persisted history, and activities can be retried. What matters most is keeping the workflow
state around and easy to inspect.

## Why SQLite Fits

SQLite is appealing because it gives you transactional durable state without introducing a separate
database service. There is no network hop, no extra control plane, and no new operational surface
area just to keep workflow progress safe. For many systems, a local database file is exactly the
right level of machinery.

## Litestream Makes It Portable

The obvious concern is what to do with those SQLite files once experiments start to accumulate. That
is where <a target="_blank" href="https://litestream.io/">Litestream</a> helps. It can stream SQLite
changes asynchronously to S3-compatible object storage. That gives you a simple way to keep working
state close to the runtime while still copying databases out for backup, migration, and inspection.

The caveat is that Litestream replication is asynchronous. A restore can miss the newest local
writes if the SQLite volume disappears before they are copied. That is fine for many AI and
experimentation workflows, but it is not the same thing as a highly available shared database.

That still leads to a useful operating model: run an Obelisk server with a SQLite database, back it
up with Litestream, and let an observer pull interesting databases when needed. The same file can be
used for local replay, debugging, and understanding what an agent actually did.

## Why This Works Well For Agents

This is especially attractive for AI agents and AI-generated workflows. Those systems are often
bursty, experimental, and easier to reason about when each agent or tenant has a small
self-contained unit of state. A fleet of tiny servers in micro VMs or containers, each with its own
SQLite database and object storage backup, is often a better fit than one large always-on shared
system. It is simpler, cheaper, and gives better fault isolation.

## When To Use Postgres Instead

SQLite is not the answer to every deployment shape. Obelisk also supports Postgres, and that is the
right choice when you need higher availability, broader shared scalability, or other deployment
properties that are better served by a network database. It is also the better fit when asynchronous
replication to object storage is not the durability model you want.

Many workflow systems do not need that on day one and should not start with more infrastructure than
their state actually demands.

In a large set of cases, a local SQLite database plus Litestream backup to S3 is enough. Add cheap
workers around it and you get a durable system with very little infrastructure. For the world of AI
agents, that may be the most sensible default.
