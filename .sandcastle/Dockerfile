FROM node:22-bookworm

# Install system dependencies.
# build-essential + python3: needed by node-gyp to compile the StackRabbit
#   native C++ addon (see the StackRabbit stage below).
# postgresql-client: lets the agent apply Supabase DDL via psql + $DATABASE_URL (issue #2).
RUN apt-get update && apt-get install -y \
  git \
  curl \
  jq \
  build-essential \
  python3 \
  postgresql-client \
  && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && apt-get update && apt-get install -y gh \
  && rm -rf /var/lib/apt/lists/*

# Build-args for UID/GID alignment: sandcastle docker build-image
# defaults these to the host user's UID/GID so image-built files
# and bind-mounted files share an owner without runtime chown.
ARG AGENT_UID=1000
ARG AGENT_GID=1000

# Rename the base image's "node" user to "agent" and align UID/GID.
RUN groupmod -o -g $AGENT_GID node && usermod -o -u $AGENT_UID -g $AGENT_GID -d /home/agent -m -l agent node
USER ${AGENT_UID}:${AGENT_GID}

# Install Claude Code CLI
RUN curl -fsSL https://claude.ai/install.sh | bash

# Add Claude to PATH
ENV PATH="/home/agent/.local/bin:$PATH"

WORKDIR /home/agent

# --- StackRabbit engine (offline, generator-only) — issue #4 ---
# Native C++ addon (node-gyp) + TypeScript HTTP server, built at image time so it
# is available OFFLINE inside the sandbox. It is STARTED at runtime by the
# onSandboxReady hook in .sandcastle/main.mts and reached at $STACKRABBIT_URL
# (http://127.0.0.1:3000). Per CLAUDE.md, the engine is used ONLY by the offline
# generator and is never deployed to the play app.
# Note: the server imports `express` but omits it from package.json deps, so it
# (plus the build toolchain) is installed explicitly here.
RUN git clone --depth 1 https://github.com/GregoryCannon/StackRabbit /home/agent/stackrabbit \
  && cd /home/agent/stackrabbit \
  && npm install \
  && npm install --no-save typescript node-gyp \
  && npx node-gyp rebuild
# express@4 specifically: the server uses app.get("*"), which Express 5's
# path-to-regexp rejects ("Missing parameter name"). Kept in a layer after the
# native build so server-side tweaks don't trigger a full C++ recompile.
RUN cd /home/agent/stackrabbit \
  && npm install --no-save express@4 \
  && npx tsc \
  && test -f built/src/server/app.js
WORKDIR /home/agent

# In worktree sandbox mode, Sandcastle bind-mounts the git worktree at /home/agent/workspace
# and overrides the working directory to /home/agent/workspace at container start.
# Structure your Dockerfile so that /home/agent/workspace can serve as the project root.
ENTRYPOINT ["sleep", "infinity"]
