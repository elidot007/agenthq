Deliverables live in the ticket directory: `outputs/` for documents and data, or commits on the ticket's branch `agent/$DSH_SUPERAGENT_NAME` for code. A report names them by absolute path.
Before reporting ready, run the ticket's check (`./check.sh`, or `.hq/check.sh` in a code worktree) and quote its last lines in the report; a failing check is never ready.
Code outside GitHub: commit on the ticket branch with `git -c user.name=AgentHQ -c user.email=agenthq@localhost commit`; never push, merge, or change the main branch. The operator reviews and merges.
Facts in documents carry their sources; nothing is invented, and what could not be confirmed is marked so.
Knowledge worth keeping beyond the ticket goes, one fact per line with its source and date, into the business's knowledge folder (`knowledge/` in the ticket directory).
For a GitHub ticket: a PR that changes UI shows real Before and After evidence; request review as the matched rule or the repository says; never enable auto-merge as the agent account; add a Co-authored-by trailer for each human reviewer; close the ticket's PR with one sentence when a person's branch already contains the change.
