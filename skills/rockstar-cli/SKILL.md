---
name: rockstar-cli
description: Use this skill to write shell scripts or run shell commands to automate browser tasks with human-like interactions, manage workflows, and control pages via the Rockstar CLI.
---

The `rockstar` CLI lets you automate browser interactions with human-like behavior from your terminal.

## Setup

_Note: If this is your very first time using the CLI, see [references/installation.md](references/installation.md) for setup. Installation is a one-time prerequisite and is **not** part of the regular AI workflow._

## AI Workflow

1. **Execute**: Run tools directly (e.g., `rockstar list_pages`). The background daemon starts implicitly on the first command; **do not** run `start`/`status`/`stop` before each use.
2. **Inspect**: Use `take_snapshot` to get an element `<uid>`.
3. **Act**: Use `click_like_human`, `type_like_human`, etc. State persists across commands.
4. **Automate**: Build multi-step workflows with `create_workflow` + `add_workflow_step`, then execute with `run_workflow`.

The daemon automatically shuts down after 10 minutes of inactivity.

Snapshot example:

```
uid=1_0 RootWebArea "Example Domain" url="https://example.com/"
  uid=1_1 heading "Example Domain" level="1"
  uid=1_2 link "More information..." url="https://www.iana.org/help/example-domains"
```

## Command Usage

```sh
rockstar <tool> [arguments] [flags]
```

Use `--help` on any command. Output defaults to Markdown, use `--output-format=json` for JSON.

## Snapshot & Inspection

```bash
rockstar take_snapshot                              # Take a text snapshot of the page to get UIDs
rockstar take_snapshot --verbose true                # Take a verbose snapshot with all a11y info
rockstar take_snapshot --filePath "snapshot.txt"     # Save snapshot to a file
rockstar take_screenshot                            # Take a screenshot of the page viewport
rockstar take_screenshot --fullPage true             # Take a full page screenshot
rockstar take_screenshot --uid "1_3" --filePath "el.png"  # Screenshot a specific element and save to file
rockstar take_screenshot --format jpeg --quality 80  # Take a JPEG screenshot with custom quality
```

## Human-Like Input Automation (<uid> from snapshot)

```bash
rockstar click_like_human "uid"                     # Click an element with realistic human behavior
rockstar type_like_human "uid" "Hello World"        # Type text into an element with realistic behavior
rockstar click_at_like_human 350 200                # Click at coordinates with realistic human behavior
rockstar drag_like_human "from_uid" "to_uid"        # Drag an element onto another with realistic behavior
```

These tools simulate natural human behavior including:
- Bezier curve mouse movements
- Natural scroll-into-view with mouse wheel momentum
- Hover dwell before clicking
- Realistic mousedown/mouseup hold timing
- Typing with ~55 WPM rhythm, shift handling, and occasional typo correction
- Natural pickup pause and drop settling for drag operations

## Workflow Management

### Creating & Building Workflows

```bash
rockstar create_workflow "Login Flow"                                        # Create a new workflow
rockstar create_workflow "Login Flow" --website_url "https://app.example.com" --description "Automates login"  # Create with metadata
rockstar list_workflows                                                      # List all workflows and their steps
```

### Adding Steps to a Workflow

```bash
rockstar add_workflow_step 1 click --uid "1_5"                               # Add a click step
rockstar add_workflow_step 1 type --uid "1_6" --action_value "{{username}}"   # Add a type step with variable
rockstar add_workflow_step 1 wait --action_value "2000"                       # Add a wait step (2000ms)
rockstar add_workflow_step 1 nav --action_value "https://example.com"         # Add a navigation step
rockstar add_workflow_step 1 hover --uid "1_7"                               # Add a hover step
rockstar add_workflow_step 1 extract --uid "1_8"                             # Add an extract step
rockstar add_workflow_step 1 screenshot --action_value "result.png"          # Add a screenshot step
rockstar add_workflow_step 1 scroll --uid "1_9" --action_value "300"         # Add a scroll step
rockstar add_workflow_step 1 upload_image --uid "1_10" --action_value "https://example.com/img.png"  # Upload an image
rockstar add_workflow_step 1 click --uid "1_5" --step_order 3               # Update an existing step by order
rockstar add_workflow_step 1 type --uid "1_6" --action_value "text" --step_description "Enter username"  # Add with description
```

Supported actions: `click`, `type`, `wait`, `scroll`, `nav`, `hover`, `extract`, `screenshot`, `upload_image`

### Running & Simulating Workflows

```bash
rockstar run_workflow 1                                                      # Run all steps of workflow 1
rockstar run_workflow 1 --step_order 3                                       # Run only step 3
rockstar run_workflow 1 --variables '{"username":"john","password":"secret"}' # Run with template variables
rockstar simulate_workflow 1                                                 # Preview workflow without executing
rockstar simulate_workflow 1 --pause_ms 3000                                 # Simulate with custom pause per step
rockstar simulate_workflow 1 --step_order 2                                  # Simulate only step 2
```

Template variables use `{{variable_name}}` syntax in `action_value` fields and are resolved at runtime via the `--variables` flag.

## Navigation

```bash
rockstar list_pages                                  # Get a list of pages open in the browser
```

## Service Management

```bash
rockstar start    # Start or restart the daemon
rockstar status   # Check if the daemon is running
rockstar stop     # Stop the daemon
```

The daemon starts automatically on first command and stops after 10 minutes of inactivity.
