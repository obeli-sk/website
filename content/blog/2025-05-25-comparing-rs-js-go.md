+++
title = "Comparing Rust, JavaScript and Go for authoring WASM Components"
date = 2025-05-25
slug = "comparing-rust-javascript-and-go-for-authoring-wasm-components"
+++

This month has already seen five Obelisk releases, each focused on adding **experimental**
JavaScript and Go support to the runtime. Although WASM format is source-language agnostic, both
JavaScript and Go needed tweaks, workarounds and sometimes upstream tooling fixes to get fully
working with the <a href="https://component-model.bytecodealliance.org/" target="_blank">WASM
Component Model</a>. In this post we'll explore rewriting an activity, workflow and a webhook from
Rust. All code examples are available in the
[Stargazers repository](https://github.com/obeli-sk/demo-stargazers/).

<!-- more -->

The first to tackle is JavaScript.

## JavaScript Tooling

The
[Component Model Website](https://component-model.bytecodealliance.org/language-support/javascript.html)
has a large section dedicated to the language. Since we are focusing on compiling into WASM, the
most relevant tool is [ComponentizeJS](https://github.com/bytecodealliance/ComponentizeJS). It can
be invoked with [jco](https://github.com/bytecodealliance/jco) CLI, but it can also be used directly
as a development dependency in any npm-compatible project. ComponentizeJS reads a WIT folder and a
JavaScript source, then creates the target WASM component bundled with the
[StarlingMonkey](https://github.com/fermyon/StarlingMonkey) JavaScript engine, a fork of Mozilla's
SpiderMonkey.

The process of creating a JavaScript WASM component consists of following steps:

1. Bundle the JavaScript with all of its dependencies as an ESModule.
1. Call `ComponentizeJS`, which in turn:
   1. Generates JS bindings from WIT imports and exports, transform the StarlingMonkey WASM using
      `spidermonkey-embedding-splicer`.
   1. Calls [wizzer](https://github.com/bytecodealliance/wizer) that pre-initializes the engine, and
      optinally [weval](https://github.com/bytecodealliance/weval) for AOT.
   1. Loads the WASM file and calling its init method to check for errors.
   1. Optionally stubs WASI interfaces, something that Obelisk must do for Go workflows.
   1. Finally turns the Core WASM binary into a WASM Component using `wasm-tools component new`.

## TinyGo

There are far less tools needed when it comes to Go. Currently the only way is to use
[TinyGo](https://tinygo.org/) v0.34.0 and above. A detailed guide is again available at
[Component Model Website](https://component-model.bytecodealliance.org/language-support/go.html),
but the process boils down to just two steps:

1. Generate bindings using [wit-bindgen-go](https://github.com/bytecodealliance/go-modules)
   (`wasm-tools` is still required).
1. Compile with `-target=wasip2` switch.

## Building an HTTP Client activity

Activities in Obelisk interact with the world over the network. They can write to databases, send
events, etc., but must be idempotent (retriable). Executions are automatically retried on timeouts
and errors. They are orchestrated by workflows and webhook endpoints.

Consider this WIT interface:

```wit
package stargazers:llm;

interface llm {
    respond: func(user-prompt: string, settings-json: string) -> result<string, string>;
}
```

[Source](https://github.com/obeli-sk/demo-stargazers/blob/25655ae6b398d24840cb83ea9a22133f27c1b7c1/activity/llm/interface/llm.wit)

Let's compare the Rust version with JavaScript and Go:

```rust
// Imports and serde stucts omitted.

impl Guest for Component {
    fn respond(user_prompt: String, settings: String) -> Result<String, String> {
        let api_key = env::var(ENV_OPENAI_API_KEY)
            .map_err(|_| format!("{ENV_OPENAI_API_KEY} must be set as an environment variable"))?;

        let settings: Settings =
            serde_json::from_str(&settings).expect("`settings_json` must be parseable");

        let mut messages = settings.messages;
        messages.push(Message {
            role: Role::User,
            content: user_prompt,
        });

        let request_body = OpenAIRequest {
            model: settings.model,
            messages,
            max_tokens: settings.max_tokens,
        };

        let resp = Client::new()
            .post("https://api.openai.com/v1/chat/completions")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
            .map_err(|err| format!("{:?}", err))?;

        if resp.status_code() != 200 {
            return Err(format!("Unexpected status code: {}", resp.status_code()));
        }

        let response: OpenAIResponse = resp.json().map_err(|err| format!("{:?}", err))?;

        if let Some(choice) = response.choices.into_iter().next() {
            Ok(choice.message.content)
        } else {
            Err("No response from OpenAI".to_string())
        }
    }
}
```

[Source](https://github.com/obeli-sk/demo-stargazers/blob/25655ae6b398d24840cb83ea9a22133f27c1b7c1/activity/llm/openai/src/lib.rs).

The language feels naturally integrated with the WIT specification, as WIT types like `result`,
`option` and `variant` have direct Rust counterparts.

```js
import axios from "axios";
import { getEnvironment } from "wasi:cli/environment@0.2.3";

export const llm = {
  async respond(userPrompt, settingsString) {
    console.log("Responding to", userPrompt, settingsString);
    const ENV_OPENAI_API_KEY = "OPENAI_API_KEY";
    // TODO: Switch to `process.env[ENV_OPENAI_API_KEY]` when https://github.com/bytecodealliance/ComponentizeJS/issues/190 is resolved.
    const apiKey = new Map(getEnvironment()).get(ENV_OPENAI_API_KEY);

    if (!apiKey) {
      throw `${ENV_OPENAI_API_KEY} must be set as an environment variable or passed in options`;
    }

    let settings;
    try {
      settings = JSON.parse(settingsString);
    } catch (e) {
      throw `'settings_json' must be parseable: ${e.message}`;
    }

    const initialMessages = settings.messages || [];
    if (!Array.isArray(initialMessages)) {
      throw "'settings.messages' must be an array if provided.";
    }

    const messages = [
      ...initialMessages,
      {
        role: "user",
        content: userPrompt,
      },
    ];

    const requestBody = {
      model: settings.model,
      messages: messages,
      max_tokens: settings.max_tokens,
    };

    let response;
    try {
      response = await axios.post("https://api.openai.com/v1/chat/completions", requestBody, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      });
    } catch (error) {
      throw `Simplified error: ${error.message}. Details: ${JSON.stringify(error.response.data)}`;
    }

    if (response.status !== 200) {
      throw `Unexpected status code: ${response.status}`;
    }

    const responseData = response.data;

    if (
      responseData.choices &&
      responseData.choices.length > 0 &&
      responseData.choices[0].message
    ) {
      return responseData.choices[0].message.content;
    }

    throw "No response content from OpenAI or choices array is malformed.";
  },
};
```

[Source](https://github.com/obeli-sk/demo-stargazers/blob/25655ae6b398d24840cb83ea9a22133f27c1b7c1/activity/llm/openai-js/src/index.js).

Note that to return `result<string, string>` you simply return a `String` or `throw` an error of
type `String`. Another nice touch is that the `wasi-http` client integrates with JavaScript's
`fetch` method, allowing use of Component Model agnostic libraries like `axios`.

Now, let's consider Go:

```go
// Imports and structs for JSON parsing omitted.

func respond(userPrompt string, settingsJSON string) (result cm.Result[string, string, string]) {
	// 1. API key
	apiKey := os.Getenv(openAIEnv)
	if apiKey == "" {
		return cm.Err[cm.Result[string, string, string]](
			fmt.Sprintf("%s must be set as an environment variable", openAIEnv),
		)
	}

	// 2. Parse settings
	var settings Settings
	if err := json.Unmarshal([]byte(settingsJSON), &settings); err != nil {
		return cm.Err[cm.Result[string, string, string]](
			fmt.Sprintf("invalid settings JSON: %v", err),
		)
	}

	// 3. Append user message
	settings.Messages = append(settings.Messages, Message{
		Role:    RoleUser,
		Content: userPrompt,
	})

	// 4. Build request body
	reqBody := OpenAIRequest{
		Model:     settings.Model,
		Messages:  settings.Messages,
		MaxTokens: settings.MaxTokens,
	}
	rawReq, err := json.Marshal(reqBody)
	if err != nil {
		return cm.Err[cm.Result[string, string, string]](
			fmt.Sprintf("failed to serialize request: %v", err),
		)
	}
	fmt.Println("OpenAI request:", string(rawReq))

	// 5. Do HTTP POST via wasihttp
	req, err := http.NewRequest(http.MethodPost, "https://api.openai.com/v1/chat/completions", bytes.NewReader(rawReq))
	if err != nil {
		return cm.Err[cm.Result[string, string, string]](
			fmt.Sprintf("failed to create request: %v", err),
		)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.ContentLength = int64(len(rawReq))

	resp, err := httpClient.Do(req)
	if err != nil {
		return cm.Err[cm.Result[string, string, string]](
			fmt.Sprintf("failed to make outbound request: %v", err),
		)
	}
	defer resp.Body.Close()
	rawResp, _ := io.ReadAll(resp.Body)

	// 6. Check status
	if resp.StatusCode != http.StatusOK {
		fmt.Println("OpenAI error response:", string(rawResp))
		return cm.Err[cm.Result[string, string, string]](
			fmt.Sprintf("unexpected status code: %d", resp.StatusCode),
		)
	}

	// 7. Read & parse response
	var apiResp OpenAIResponse
	if err := json.Unmarshal(rawResp, &apiResp); err != nil {
		return cm.Err[cm.Result[string, string, string]](
			fmt.Sprintf("failed to parse response JSON: %v", err),
		)
	}

	// 8. Return first choice or error
	if len(apiResp.Choices) > 0 {
		logbindings.Debug("HTTP roundtrip succeeded")
		return cm.OK[cm.Result[string, string, string]](apiResp.Choices[0].Message.Content)
	}
	return cm.Err[cm.Result[string, string, string]]("no response from OpenAI")
}
```

[Source](https://github.com/obeli-sk/demo-stargazers/blob/25655ae6b398d24840cb83ea9a22133f27c1b7c1/activity/llm/openai-go/main.go).

Writing the Go component and interfacing with the
[cm](https://github.com/bytecodealliance/go-modules/tree/main/cm) package proved to be more
difficult and less idiomatic than writing the same component in JavaScript.

The JavaScript version is the shortest: only 75 lines versus around 100 for Rust and 150 for Go.
However, the final WASM file sizes differ vastly:

- JS: 12MB
- Go: 2.6MB (with debuginfo)
- Go: ~1MB (no debuginfo)
- Rust: 4.2MB (with debuginfo)
- Rust: 417KB (optimized for size, no debuginfo)

## Translating the Stargazers Workflow

Now let's do the same thing for a workflow. The main difference from activities is the fact that
workflows need to be deterministic and thus completely separated from real world effects. Workflows
can call into other workflows and activities, creating child executions. They cannot directly
interact with the I/O, clocks or RNGs, as only persisted and replayed effects can guarantee
deterministic reexecution.

For brevity let's rewrite just a single workflow with no parallelism involved:

```wit
package stargazers:workflow;

interface workflow {

    /// Called by the GitHub webhook when a star is added to a repository.
    star-added: func(login: string, repo: string)  -> result<_, string>;
    ...
}
```

[Source](https://github.com/obeli-sk/demo-stargazers/blob/25655ae6b398d24840cb83ea9a22133f27c1b7c1/workflow/interface/workflow.wit)

The Rust version is pretty simple. First step is to make a database update, and if the database does
not contain user's description, the rest of the code will sequentially call activities to update it.

```rust
fn star_added(login: String, repo: String) -> Result<(), String> {
    // 1. Persist the user giving a star to the project.
    let description = db::user::add_star_get_description(&login, &repo)?;
    if description.is_none() {
        // 2. Fetch the account info from GitHub.
        let info = github::account::account_info(&login)?;
        // 3. Fetch the prompt from the database.
        let settings_json = db::llm::get_settings_json()?;
        // 4. Generate the user's description. This is the activity mentioned above!
        let description = llm::respond(&info, &settings_json)?;
        // 5. Persist the generated description.
        db::user::update_user_description(&login, &description)?;
    }
    Ok(())
}
```

[Source](https://github.com/obeli-sk/demo-stargazers/blob/25655ae6b398d24840cb83ea9a22133f27c1b7c1/workflow/src/lib.rs)

The JavaScript version is can be mapped 1:1 to the original:

```javascript
starAdded(login, repo) {
    try {
      // 1. Persist the user giving a star to the project. Check if description exists.
      const existingDescription = addStarGetDescription(login, repo);
      if (existingDescription === null || existingDescription === undefined) {
        // 2. Fetch the account info from GitHub.
        const info = accountInfo(login);
        // 3. Fetch the prompt settings from the database.
        const settingsJson = getSettingsJson();
        // 4. Generate the user's description using the LLM.
        const description = llmRespond(info, settingsJson);
        // 5. Persist the generated description.
        updateUserDescription(login, description);
      }
    } catch (error) {
      throw stringify_error(error);
    }
}
```

[Source](https://github.com/obeli-sk/demo-stargazers/blob/25655ae6b398d24840cb83ea9a22133f27c1b7c1/workflow-js/src/index.js)

As noted earlier, writing the Go component is more involved, mostly due to error handling.

```go
func (c *Component) StarAdded(login string, repo string) cm.Result[string, struct{}, string] {
	resDescWrapped := stargazersDbUser.AddStarGetDescription(login, repo)
	if resDescWrapped.IsErr() {
		return cm.Err[cm.Result[string, struct{}, string]](*resDescWrapped.Err())
	}
	descriptionPtr := resDescWrapped.OK().Some()

	if descriptionPtr == nil { // If description was not yet set, generate it.
		resInfoWrapped := stargazersGithubAccount.AccountInfo(login)
		if resInfoWrapped.IsErr() {
			return cm.Err[cm.Result[string, struct{}, string]](*resInfoWrapped.Err())
		}
		info := *resInfoWrapped.OK()

		resSettingsWrapped := stargazersDbLlm.GetSettingsJSON()
		if resSettingsWrapped.IsErr() {
			return cm.Err[cm.Result[string, struct{}, string]](*resSettingsWrapped.Err())
		}
		settingsJson := *resSettingsWrapped.OK()

		resLlmDescWrapped := stargazersLlmLlm.Respond(info, settingsJson)
		if resLlmDescWrapped.IsErr() {
			return cm.Err[cm.Result[string, struct{}, string]](*resLlmDescWrapped.Err())
		}
		llmDescription := *resLlmDescWrapped.OK()

		resUpdateWrapped := stargazersDbUser.UpdateUserDescription(login, llmDescription)
		if resUpdateWrapped.IsErr() {
			return cm.Err[cm.Result[string, struct{}, string]](*resUpdateWrapped.Err())
		}
	}
	return cm.OK[cm.Result[string, struct{}, string]](struct{}{})
}
```

[Source](https://github.com/obeli-sk/demo-stargazers/blob/25655ae6b398d24840cb83ea9a22133f27c1b7c1/workflow-go/main.go)

One additional [issue](https://github.com/tinygo-org/tinygo/issues/4843) with the TinyGo component
is that it always includes the `wasi:cli/command@0.2.0` world, which imports nearly 30 interfaces
like `wall-clock`, `network`, and `random`, using which adds nondeterminism on replay.

As mentioned earlier JavaScript tooling allows stubbing these interfaces, but Go does not. To work
around this, I added an experimental `stub_wasi`
<a href="{{ get_url(path='@/docs/v0.41.5/configuration.md') }}">configuration switch</a> that
handles it directly in Obelisk.

## Webhook Endpoint

As promised, we’ll look at rewriting the Stargazers webhook endpoint. This type of component is
essentially an HTTP server handler. In this post we won’t cover the actual GitHub webhook - just a
simple GET handler that queries a database and returns JSON.

In Rust we use the [waki](https://github.com/wacker-dev/waki) library to get rid of the `wasi-http`
boilerplate. A simplified GET handler looks like this:

```rust
#[handler]
fn handle(req: Request) -> Result<Response, ErrorCode> {
    if matches!(req.method(), Method::Post) {
        handle_webhook(req) // See GitHub
    } else if matches!(req.method(), Method::Get) {
        handle_get(req)
    } else {
        Err(ErrorCode::HttpRequestMethodInvalid)
    }
}

/// Render a JSON array with last few stargazers.
fn handle_get(req: Request) -> Result<Response, ErrorCode> {
    const MAX_LIMIT: u8 = 5;
    let query = req.query();
    let limit = query
        .get("limit")
        .and_then(|limit| limit.parse::<u8>().ok())
        .map(|limit| limit.min(MAX_LIMIT))
        .unwrap_or(MAX_LIMIT);
    let repo = query.get("repo").map(|x| x.as_str());
    let ordering = if query.get("ordering").map(|s| s.as_str()) == Some("asc") {
        Ordering::Ascending
    } else {
        Ordering::Descending
    };
    // Call the database activity
    let list = db::user::list_stargazers(limit, repo, ordering).map_err(|err| {
        eprintln!("{err}");
        ErrorCode::InternalError(None)
    })?;
    Response::builder().json(&list).build()
}
```

[Source](https://github.com/obeli-sk/demo-stargazers/blob/c05bc576ea0f8208583ca25e08e96d994e9248bd/webhook/src/lib.rs)

In JavaScript we will use [Hono](https://hono.dev).

```js
import { Hono } from "hono";
// WIT Imports
import { listStargazers } from "stargazers:db/user";

const app = new Hono();
// Note: WIT enum variants are not exposed by the binding generator.
const OrderingAscending = "ascending";
const OrderingDescending = "descending";

// GET endpoint to list stargazers
app.get("/", async (c) => {
  try {
    const MAX_LIMIT = 5;
    let limit = parseInt(c.req.query("limit"), 10);
    if (isNaN(limit) || limit <= 0) {
      limit = MAX_LIMIT;
    }
    limit = Math.min(limit, MAX_LIMIT);
    const repo = c.req.query("repo");
    let orderingParam = c.req.query("ordering");
    let ordering;
    if (orderingParam === "asc") {
      ordering = OrderingAscending;
    } else {
      ordering = OrderingDescending;
    }
    // Call the database activity
    const list = listStargazers(limit, repo, ordering);
    return c.json(list);
  } catch (err) {
    return c.text("Internal Server Error", 500);
  }
});

function serve(app) {
  self.addEventListener("fetch", (event) => {
    event.respondWith(app.fetch(event.request));
  });
}

serve(app);
```

[Source](https://github.com/obeli-sk/demo-stargazers/blob/c05bc576ea0f8208583ca25e08e96d994e9248bd/webhook-js/src/index.js)

In Go we'll employ [httprouter](github.com/julienschmidt/httprouter).

```go
package main
import "github.com/julienschmidt/httprouter"
import dbbindings "github.com/obeli-sk/demo-stargazers/webhook-go/gen/stargazers/db/user"

func init() {
	router := httprouter.New()
	router.HandlerFunc(http.MethodPost, "/", postHandler)
	router.HandlerFunc(http.MethodGet, "/", getHandler)
	// Other methods will automatically result in a 405 Method Not Allowed from httprouter
	wasihttp.Handle(router)
}

func getHandler(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()

	limitStr := query.Get("limit")
	limit := maxQueryLimit // Default
	if limitStr != "" {
		parsedLimit, err := strconv.ParseUint(limitStr, 10, 8)
		if err == nil {
			limit = uint8(parsedLimit)
			if limit > maxQueryLimit {
				limit = maxQueryLimit
			}
		} else {
			fmt.Printf("Invalid limit query parameter '%s': %v. Using default %d.\n", limitStr, err, maxQueryLimit)
		}
	}

	repoQuery := query.Get("repo")
	var actualRepoArg cm.Option[string]
	if repoQuery != "" {
		actualRepoArg = cm.Some(repoQuery)
	} else {
		actualRepoArg = cm.None[string]()
	}

	dbOrdering := dbbindings.OrderingDescending
	if query.Get("ordering") == "asc" {
		dbOrdering = dbbindings.OrderingAscending
	}

    // Call the database activity
	result := dbbindings.ListStargazers(limit, actualRepoArg, dbOrdering)

	if result.IsErr() {
		errMsg := result.Err()
		fmt.Printf("Error from list-stargazers: %s\n", errMsg)
		http.Error(w, "Failed to retrieve stargazer list", http.StatusInternalServerError)
		return
	}

	witStargazerList := result.OK().Slice()

	// Convert to JSON-friendly structs
	jsonStargazerList := make([]JSONStargazer, len(witStargazerList))
	for i, s := range witStargazerList {
		jsonStargazerList[i].Login = s.Login
		jsonStargazerList[i].Repo = s.Repo
		jsonStargazerList[i].Description = s.Description.Some()
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(jsonStargazerList); err != nil {
		fmt.Printf("Error encoding JSON response: %v\n", err)
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
	}
}
```

[Source](https://github.com/obeli-sk/demo-stargazers/blob/c05bc576ea0f8208583ca25e08e96d994e9248bd/webhook-go/main.go)

One nice thing is that we can use any router based on `net/http`. What’s less nice is that we have
to rewrite structs for JSON serialization, as the binding generator is quite limited.

## Conclusion

Which language should you use to write WASM components?

Since most of the Component Model tooling is built in Rust, the choice is obvious for Rustaceans.

However, if you're choosing between JavaScript and Go, in 2025 I’d go with JavaScript. Despite
larger WASM file sizes, you’ll benefit from an active community and well-integrated tooling.

Go’s main advantage is compile-time checking of generated bindings, preventing incorrect parameter
and return types. This comes at the cost of higher verbosity and sometimes less idiomatic code.
