# Application Architecture

## Current State

The current repository is a Python-first prototype that:

- resolves venues via Google Maps
- pulls Google review context and website signals
- builds a report JSON artifact
- writes diagnostics for source health

This prototype is operator-driven and file-based.

## Target State

The application becomes a multi-tenant product with three major layers:

### 1. Dashboard Layer

A web dashboard where customers:

- authenticate
- create projects
- enter target and competitor URLs
- trigger runs
- inspect reports and diagnostics
- compare trends over time

### 2. API and Job Layer

An authenticated API that:

- validates input
- stores project data
- creates analysis runs
- enqueues work
- exposes reports, diagnostics, and trends

The job runner executes the collection and report pipeline asynchronously.

### 3. Data and Signal Layer

Persistent storage for:

- projects and targets
- run state
- diagnostics
- normalized signals
- versioned reports

## Transitional Architecture

The fastest path from prototype to product is:

1. Keep the Python engine as the reference collector.
2. Add a dashboard and API shell around current report artifacts.
3. Move runtime inputs from files to API payloads and persisted tables.
4. Gradually refactor the Python pipeline into modular stages that can run from jobs.

## Design Principles

- User input should be database-backed, not file-backed.
- Signals should be explainable and queryable.
- Diagnostics should be first-class, not hidden logs.
- Coverage should be surfaced everywhere a customer reads a report.
- Industry behavior should come from profiles before code branches.
