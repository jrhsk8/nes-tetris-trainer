FROM node:22-bookworm

# Install system dependencies.
# build-essential + python3: needed by node-gyp to compile the StackRabbit
#   native C++ addon (see the StackRabbit stage below).
# postgresql-client: lets the agent apply Supabase DDL via psql + $DATABASE_URL (issue #2).
# bzip2: needed to extract the micromamba tarball (.tar.bz2) for the BetaTetris stage (#54).
RUN apt-get update && apt-get install -y \
  git \
  curl \
  jq \
  build-essential \
  python3 \
  postgresql-client \
  bzip2 \
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

# --- BetaTetris cross-check engine (offline, generator-only) — issue #54 ---
# A strong independent NN engine used ONLY at generation time for the BetaTetris
# true-consensus filter (#54). Baked in at image time so it is available OFFLINE
# inside the sandbox, mirroring the StackRabbit stage above. Invoked on demand (a
# Python forward pass), NOT a long-running server — so no onSandboxReady start.
#
# License / guardrail: betatetris-tablebase is GPLv3 (StackRabbit is MIT). It is
# vendored ONLY into this private, never-distributed sandcastle image and stays
# strictly offline / generator-only — never linked into or shipped with the play
# app (per CLAUDE.md "engine offline-only"). Needs an AVX2/BMI2 CPU (the host has
# one). Adds ~1.2-1.5 GB to the image (pytorch-cpu + ~166 MB weights).
#
# Env replicates the *proven* supervised setup (see betatetris-spike/README.md): a
# userspace micromamba env `bt` (python 3.12 + pytorch-cpu). The image has apt,
# but we mirror the validated env exactly to avoid a python-3.11-vs-3.12 build
# risk against the C++ extension.
ENV MAMBA_ROOT_PREFIX=/home/agent/micromamba
ENV BT_HOME=/home/agent/betatetris
ENV BT_REPO_PY=/home/agent/betatetris/betatetris-tablebase/python
ENV BT_MODELS=/home/agent/betatetris/models
ENV BT_ENV=bt
# micromamba (userspace, no sudo) -> /home/agent/.local/bin (already on PATH).
RUN mkdir -p /home/agent/.local \
  && curl -Ls https://micro.mamba.pm/api/micromamba/linux-64/latest \
     | tar -xj -C /home/agent/.local bin/micromamba \
  && micromamba --version
# The validated `bt` env: python 3.12 + pytorch-cpu + the C++ build toolchain.
RUN micromamba create -y -n ${BT_ENV} -c conda-forge \
    python=3.12 'pytorch=*=cpu*' numpy scipy cmake make pybind11 gxx gcc onnxruntime \
  && micromamba run -n ${BT_ENV} pip install --no-cache-dir 'psycopg[binary]' \
  && micromamba clean -y -a
# Engine: clone betatetris-tablebase (GPLv3) and build the `tetris` C++ extension
# (default args => rotation build, kR=4 — the NES-correct variant). The committed
# noro.pth is a no-rotation variant (wrong for NES) and is never used.
RUN git clone --depth 1 https://github.com/BetaTetris/betatetris-tablebase.git ${BT_HOME}/betatetris-tablebase \
  && cd ${BT_HOME}/betatetris-tablebase/python/tetris \
  && micromamba run -n ${BT_ENV} python setup.py build_ext --inplace
# Weights (v1.0.0 perfect + normal; ~83 MB each) from Releases. Note the normal
# net lives under the v1.0.0 tag, the perfect net under v1.0.0-perfect.
RUN mkdir -p ${BT_MODELS} \
  && curl -fL -o ${BT_MODELS}/model-v1.0.0-perfect.pth \
     https://github.com/BetaTetris/betatetris-tablebase/releases/download/v1.0.0-perfect/model-v1.0.0-perfect.pth \
  && curl -fL -o ${BT_MODELS}/model-v1.0.0-normal.pth \
     https://github.com/BetaTetris/betatetris-tablebase/releases/download/v1.0.0/model-v1.0.0-normal.pth \
  && test -s ${BT_MODELS}/model-v1.0.0-perfect.pth \
  && test -s ${BT_MODELS}/model-v1.0.0-normal.pth
# Convenience wrapper so the generator can run a script inside the env, e.g.
#   bt-run python betatetris-spike/compare.py
RUN printf '#!/usr/bin/env bash\nexec micromamba run -n %s "$@"\n' "${BT_ENV}" \
     > /home/agent/.local/bin/bt-run \
  && chmod +x /home/agent/.local/bin/bt-run
WORKDIR /home/agent

# In worktree sandbox mode, Sandcastle bind-mounts the git worktree at /home/agent/workspace
# and overrides the working directory to /home/agent/workspace at container start.
# Structure your Dockerfile so that /home/agent/workspace can serve as the project root.
ENTRYPOINT ["sleep", "infinity"]
