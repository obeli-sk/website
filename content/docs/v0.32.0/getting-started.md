+++
title = "Getting Started with Obelisk"
template = "docs.html"
weight = 0
+++

Welcome to Obelisk! This guide will help you get started with building and running resilient workflows and activities. There are two main paths you can take to begin your Obelisk journey:

1.  **Run a Pre-built Demo:** Experience Obelisk in action by running a complete, working example. This is the fastest way to see the system's capabilities without writing any code.

2.  **Build Your Own Workflow/Activity:** Dive into the core concepts and start building your own custom workflows and activities. This path involves understanding the Obelisk architecture and writing code.

## Stargazers Demo
The quickest way to get a feel for Obelisk is to run the [Stargazers demo](https://github.com/obeli-sk/demo-stargazers). Consider this workflow:
```rust
fn star_added(login: String, repo: String) -> Result<(), String> {
    // 1. Persist the user giving a star to the project.
    let description = db::user::add_star_get_description(&login, &repo)?;
    if description.is_none() {
        // 2. Fetch the account info from GitHub.
        let info = github::account::account_info(&login)?;
        // 3. Fetch the prompt from the database.
        let settings_json = db::llm::get_settings_json()?;
        // 4. Generate the user's description.
        let description = llm::respond(&info, &settings_json)?;
        // 5. Persist the generated description.
        db::user::update_user_description(&login, &description)?;
    }
    Ok(())
}
```

The demo repository contains:

*   A [**webhook endpoint**](https://github.com/obeli-sk/demo-stargazers/blob/main/webhook) that receives the  "star added" event from GitHub.
*   A [**workflow**](https://github.com/obeli-sk/demo-stargazers/blob/main/workflow) that orchestrates the process.
*   Three **activities:**
    *   Fetching account information from [GitHub](https://github.com/obeli-sk/demo-stargazers/tree/main/activity/github/impl).
    *   Using an [LLM](https://github.com/obeli-sk/demo-stargazers/tree/main/activity/llm/openai) to generate text based on the account information.
    *   Persisting the result in a [Turso database](https://github.com/obeli-sk/demo-stargazers/tree/main/activity/db/turso).

This demo provides a practical example of how Obelisk handles real-world events and integrates different components.

**Steps to Run the Demo:**

1.  **Install Obelisk:** Follow the installation instructions on the [Installation page](https://obeli.sk/install/).

2.  **Clone the Demo Repository:**

```bash
git clone https://github.com/obeli-sk/demo-stargazers.git
cd demo-stargazers
```
Let's explore some of the folders:
```
demo-stargazers
├── activity
│   ├── db                      # Database activity
│   │   ├── interface           # WIT describing the API
│   │   ├── interface-ext       # Generated extension functions
│   │   └── turso               # Cargo project with the activity implementation
│   ├── github                  # GitHub activity
│   │   ├── impl                # Cargo project with the activity implementation
│   │   ├── interface
│   │   └── interface-ext
│   └── llm                     # LLM activity
│       ├── openai             # Cargo package with the activity implementation
│       ├── interface
│       └── interface-ext
├── webhook                     # Cargo package with the webhook endpoint
├── wit                         # Obelisk WIT types and support functions
└── workflow                    # Cargo package with the workflow implementation
    └── wit
```

3. **Set up API tokens**

Follow the [Setting Up](https://github.com/obeli-sk/demo-stargazers/blob/main/README.md#setting-up) chapter of the readme. You will need the tokens for:
* Turso database
* OpenAI
* GitHub

Configure your environment variables according to the activities' readmes.

4.  **Run the Obelisk Server:**

```bash
export GITHUB_TOKEN="..."
export GITHUB_WEBHOOK_SECRET="..."
export OPENAI_API_KEY="..."
export TURSO_TOKEN="..."
export TURSO_LOCATION="[databaseName]-[organizationSlug].turso.io"
obelisk server run --config obelisk-oci.toml
```

5.  **Configure GitHub Webhook (Optional):** For the demo to work fully, you'll need to configure a GitHub webhook to send "star added" events to your running Obelisk instance.  This will involve exposing the webhook's HTTP server to the internet temporarily. *Detailed instructions for setting up the webhook are provided in the [webhook's README](https://github.com/obeli-sk/demo-stargazers/blob/main/webhook/README.md).*  If you skip this step, you can still interact with the workflow using the Obelisk CLI, Web UI or any HTTP client triggering the webhook endpoint, but it won't be triggered automatically by GitHub events.

6.  **Interact with the Demo:** Once the server is running and (optionally) the webhook is configured, you can:
* Star the repository (if the webhook is set up).
* Use the Obelisk CLI or Web UI to manually trigger workflow executions.
* Don't forget you can **kill the server** or **simulate network issues** during workflow execution! When the server is back up (and retries have not been exhausted), the workflow will continue.

The [repository's README](https://github.com/obeli-sk/demo-stargazers/blob/main/README.md) provides detailed instructions for each of these steps, including setting up the GitHub webhook and interacting with the running system.

## Building Your Own Workflow/Activity

If you're ready to start building your own custom workflows and activities, here's a recommended learning path:

1.  **Understand the Core Concepts:**  Familiarize yourself with the fundamental building blocks of Obelisk:

* {{ doc_link(title="**Workflows**", path="concepts/workflows/_index.md") }}:  Learn how workflows orchestrate the execution of activities and other workflows.  Understand their deterministic nature and how Obelisk manages the execution log.

* {{ doc_link(title="**Activities**", path="concepts/activities/_index.md") }}:  Understand the role of activities as the fundamental units of work.  Learn about idempotency, the WASM sandbox, and the built-in resilience features.

* {{ doc_link(title="**Webhook Endpoints**", path="concepts/webhook-endpoints.md") }}:  Learn how to trigger executions via incoming HTTP requests.

* {{ doc_link(title="**Join Sets**", path="concepts/workflows/join-sets.md") }}: Understand how to manage concurrent executions.

* {{ doc_link(title="**Extension Functions**", path="concepts/extensions.md") }}: Learn how Obelisk auto-generates functions for submitting, awaiting and scheduling.

* {{ doc_link(title="**Runtime Support**", path="concepts/runtime-support.md") }}: See functions available in the runtime.

2.  **Explore the Configuration:** Learn how to configure Obelisk using the `obelisk.toml` file:

* {{ doc_link(title="**Configuration**", path="configuration.md") }}: Understand how to define workflows, activities, webhook endpoints, HTTP servers, and other settings.

3.  **Start with a Template:**  Use the `cargo-generate` tool and the provided Obelisk templates to quickly create a new project:

```bash
cargo generate obeli-sk/obelisk-templates
```

The available templates provide a basic structure, including the necessary WIT files, Rust code, and `obelisk.toml` configuration.  They also include instructions in their READMEs on how to build and run the generated code.

4.  **Build and Deploy:**

* Compile your code into a WebAssembly Component using `cargo build --release`.
* Run the Obelisk server: `obelisk server run`.
* (Optional) Push your WASM component to an OCI registry using `obelisk client component push`.

5.  **Interact and Iterate:**

* Use the {{ doc_link(title="Obelisk CLI", path="cli.md") }}, Web UI, or gRPC API to interact with your deployed workflows and activities.
* Iteratively refine your code, configuration, and deployment process.

The provided documentation links and project templates will guide you through each step of the process.
