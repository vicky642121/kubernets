# Docker & Kubernetes Learning Journal

A beginner's journal of learning **Docker** and **Kubernetes (Minikube)** by running a small three-part app (React frontend, Node.js backend, PostgreSQL database) as plain Pods on a local cluster.

> **About accuracy:** The files and commands below come from my own project and practice. Parts that are general background (for example, the architecture section) are explained from standard Kubernetes concepts. Where something is a known weakness in my setup, I say so. Output samples are illustrative, not pasted from a verified run.

---

## Table of Contents

1. [Project overview and prerequisites](#1-project-overview-and-prerequisites)
2. [Project structure](#2-project-structure)
3. [Docker fundamentals and Dockerfile explanation](#3-docker-fundamentals-and-dockerfile-explanation)
4. [Building and loading images](#4-building-and-loading-images)
5. [Minikube setup (Ubuntu)](#5-minikube-setup-ubuntu)
6. [Pod YAML files explained line by line](#6-pod-yaml-files-explained-line-by-line)
7. [Commands explained](#7-commands-explained)
8. [Kubernetes architecture: control plane and worker nodes](#8-kubernetes-architecture-control-plane-and-worker-nodes)
9. [Frontend, backend and PostgreSQL communication](#9-frontend-backend-and-postgresql-communication)
10. [Troubleshooting](#10-troubleshooting)
11. [What I have learned](#11-what-i-have-learned)
12. [What I plan to learn next](#12-what-i-plan-to-learn-next)

---

## 1. Project overview and prerequisites

### What this project is

| Part | Tech | Image | Port |
|------|------|-------|------|
| Frontend | React + Vite | `k8-frontend:dev` | 5173 |
| Backend | Node.js + Express + `pg` | `k8-backend:v1` | 3000 |
| Database | PostgreSQL | `postgres:13` (official image) | 5432 |

The backend exposes `GET /health`, `GET /api/products` and `GET /api/products/:id`. Products are read from a `products` table in PostgreSQL. The frontend fetches the product list and shows it.

There is also a small `PythonBackEnd/` (FastAPI) folder. It is a side experiment and is **not** part of the Kubernetes setup described here.

### Prerequisites

| Tool | Why | Check it |
|------|-----|----------|
| Ubuntu (Linux) | The OS I used | `lsb_release -a` |
| Docker | Build images, and Minikube's `docker` driver runs on it | `docker --version` |
| Minikube | A small local Kubernetes cluster | `minikube version` |
| kubectl | Command-line tool to talk to Kubernetes | `kubectl version --client` |
| Node.js 22 (optional) | Only to run the apps outside Docker | `node -v` |

---

## 2. Project structure

```text
kubernetsLearning/
├── BackEnd/
│   ├── Dockerfile                       # recipe for k8-backend:v1
│   ├── package.json
│   ├── migrate.js                       # runs the CREATE TABLE migration
│   ├── src/
│   │   ├── server.js                    # starts Express on 0.0.0.0:PORT
│   │   ├── app.js                       # middleware + routes + error handler
│   │   ├── db.js                        # PostgreSQL connection pool
│   │   └── routes/product.routes.js     # /api/products endpoints
│   ├── database/
│   │   ├── migrations/001_create_products.sql   # creates the table
│   │   └── seeders/001_seed_products.sql        # inserts 3 sample rows
│   └── kubernetes/
│       ├── Backend-pod.yaml
│       └── Pgsql-pod.yaml
├── FrontEnd/
│   ├── Dockerfile                       # recipe for k8-frontend:dev
│   ├── src/App.jsx                      # fetches the products
│   └── kubernetes/
│       └── Frontend-pod.yaml
└── PythonBackEnd/                       # separate FastAPI experiment (not in K8s)
```

---

## 3. Docker fundamentals and Dockerfile explanation

### Core ideas

| Term | Simple meaning | Analogy |
|------|----------------|---------|
| **Dockerfile** | A text file of steps describing how to build an image | A recipe |
| **Image** | A read-only package: OS files + runtime + your code | A frozen meal |
| **Container** | A running instance of an image | The meal being served |
| **Tag** | A label after the colon in a name (`k8-backend:v1`) | A version sticker |
| **Registry** | A place images are stored (Docker Hub is the default) | A shop |

Image name format: `name:tag`. If you leave the tag off, Docker uses `latest`. This matters later: Kubernetes treats `:latest` differently when deciding whether to pull (see [`imagePullPolicy`](#6-pod-yaml-files-explained-line-by-line)).

**Image vs container vs Pod:** You *build* an image once. Docker *runs* it as a container. Kubernetes wraps one or more containers in a **Pod**. So: image → (run) → container → (wrapped by) → Pod.

### My backend Dockerfile (`BackEnd/Dockerfile`)

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 3000
CMD ["npm","run","dev"]
```

### My frontend Dockerfile (`FrontEnd/Dockerfile`)

Identical to the backend except for the port and the command:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
```

### Instruction-by-instruction

#### `FROM node:22-alpine`

| | |
|---|---|
| **Meaning** | Start from an existing base image: Node.js 22 on Alpine Linux (a very small Linux). |
| **Why** | You get Node and npm without installing them yourself. Alpine keeps the image small. |
| **When executed** | At build time Docker pulls `node:22-alpine` if it is not already on your machine. Every later step builds on top of it. |
| **If omitted** | The build fails. `FROM` is the first real instruction in every Dockerfile. |
| **If wrong** | A typo in the name or tag (`node:222-alpine`) gives "manifest not found" or "pull access denied". |
| **Required?** | **Required.** |

#### `WORKDIR /app`

| | |
|---|---|
| **Meaning** | Sets the working folder inside the image. Later `COPY`, `RUN` and `CMD` happen here. |
| **Why** | Keeps your app in its own tidy folder instead of the root `/`. |
| **When executed** | Creates `/app` if missing and moves into it. |
| **If omitted** | Files land in `/` (the root), which is messy and can clash with system files. `npm` commands would run in the wrong place. |
| **Required?** | Optional, but strongly recommended. |

#### `COPY package*.json ./`

| | |
|---|---|
| **Meaning** | Copy `package.json` and `package-lock.json` from your computer into the current folder (`/app`) in the image. |
| **Why (the caching trick)** | Docker caches each step. If these two files have not changed, Docker reuses the cached `npm ci` result and skips reinstalling. Copying only these files *first* makes rebuilds much faster when you only change source code. |
| **If omitted** | `npm ci` fails: no `package.json` found. |
| **If you copied everything first** | It works but is slower, since any code change invalidates the install cache. |
| **Required?** | Optional in theory; required in practice for a Node app using this pattern. |

#### `RUN npm ci`

| | |
|---|---|
| **Meaning** | Runs a command **while building** the image. `npm ci` installs the exact versions listed in `package-lock.json`. |
| **Why** | Repeatable installs. Unlike `npm install`, it never changes the lock file. |
| **When executed** | Build time only (not when the container starts). Results are saved into the image. |
| **If omitted** | The image has no `node_modules`; the app crashes at start with "Cannot find module". |
| **Common error** | `npm ci` fails if `package-lock.json` is missing or out of sync with `package.json`. |
| **Required?** | Optional for Docker, but required for this app. |

#### `COPY . .`

| | |
|---|---|
| **Meaning** | Copy everything from the project folder (first `.`) to the current image folder `/app` (second `.`). |
| **Why** | Puts your source code in the image. |
| **If omitted** | The image has dependencies but no code. |
| **Watch out** | Without a `.dockerignore` file, this also copies your local `node_modules`, `.env` and other junk into the image (it can overwrite the clean ones installed by `npm ci`). Adding a `.dockerignore` listing `node_modules` and `.env` is a good next step; I have not added one yet. |
| **Required?** | Optional technically, needed in practice. |

#### `EXPOSE 3000`

| | |
|---|---|
| **Meaning** | Documentation: "this app listens on port 3000." |
| **Why** | Tells people (and tools) which port the app uses. |
| **What it does NOT do** | It does **not** publish or open the port. With plain Docker you still need `docker run -p 3000:3000 ...`. |
| **If omitted** | Nothing breaks. The app still listens on whatever port it was coded to use. |
| **Required?** | **Optional** (informational only). |

#### `CMD ["npm","run","dev"]`

| | |
|---|---|
| **Meaning** | The default command run when a container starts from this image. |
| **Why** | Without it, the container has nothing to do. |
| **Format** | The JSON-array form (`["a","b"]`, "exec form") runs the program directly. It is preferred over a plain string. |
| **If omitted** | The container starts and exits immediately (the base image's default is just a shell/Node REPL, not your app). |
| **Difference vs `RUN`** | `RUN` happens once at **build** time. `CMD` happens each time a container **starts**. |
| **Required?** | Practically required (one is needed to run something). |

#### The frontend's `-- --host 0.0.0.0`

`npm run dev -- --host 0.0.0.0` passes `--host 0.0.0.0` to Vite. By default Vite only listens on `localhost` *inside* the container, which nothing outside the container can reach. `0.0.0.0` means "listen on all network interfaces". **If omitted**, the container runs but you cannot reach the page from outside it. The backend does the same thing in code: `app.listen(PORT, "0.0.0.0", ...)` in `server.js`.

> **Note:** `npm run dev` (nodemon / Vite dev server) is a *development* setup. It's fine for learning. Production images usually run `node src/server.js` or serve a built bundle.

---

## 4. Building and loading images

### Step 1: Build the images

```bash
# From the BackEnd folder
cd BackEnd
docker build -t k8-backend:v1 .

# From the FrontEnd folder
cd ../FrontEnd
docker build -t k8-frontend:dev .
```

- `-t k8-backend:v1` gives the image a name and tag.
- `.` is the **build context**: the folder Docker reads files from. It must contain the Dockerfile.

### Step 2: Check the images exist

```bash
docker images
```

You should see `k8-backend` with tag `v1` and `k8-frontend` with tag `dev`.

### Step 3: Pull PostgreSQL

```bash
docker pull postgres:13
```

This downloads the official PostgreSQL 13 image from Docker Hub. We don't build this one; we use it as is.

### Step 4: Load local images into Minikube

Minikube runs its own Docker environment inside a node. **Your computer's Docker images are not automatically visible to it.** Since `k8-backend:v1` only exists on your machine (it is not on Docker Hub), you must load it:

```bash
minikube image load k8-backend:v1
minikube image load k8-frontend:dev
minikube image load postgres:13     # optional; Minikube can pull it from Docker Hub itself
```

Verify:

```bash
minikube image ls
```

**If you skip this step:** the Pod tries to download `k8-backend:v1` from Docker Hub, can't find it, and ends in `ErrImagePull` → `ImagePullBackOff` (see [Troubleshooting](#10-troubleshooting)).

**Reminder:** If you rebuild an image with the *same tag*, load it again. Minikube won't notice the change on its own.

---

## 5. Minikube setup (Ubuntu)

Minikube creates a tiny, single-node Kubernetes cluster on your own computer. Official install steps can change, so check <https://minikube.sigs.k8s.io/docs/start/> for current instructions. The typical flow is:

```bash
# 1. Install Docker first (needed for --driver=docker) and let your user use it
sudo usermod -aG docker $USER && newgrp docker

# 2. Install minikube and kubectl (see the official docs for current download links)

# 3. Start the cluster
minikube start --driver=docker

# 4. Check it
minikube status
kubectl get nodes
```

Expected shape of a healthy `minikube status`:

```text
minikube
type: Control Plane
host: Running
kubelet: Running
apiserver: Running
kubeconfig: Configured
```

`kubectl get nodes` should show one node named `minikube` with status `Ready`.

Handy extras: `minikube stop` (pause the cluster), `minikube delete` (remove it completely, which also deletes everything inside), and `minikube dashboard` (web UI).

---

## 6. Pod YAML files explained line by line

A **Pod** is the smallest thing you can run in Kubernetes: a wrapper around one (or more) containers that share a network and storage. A YAML file is a *description of what you want*; `kubectl apply` hands it to the cluster.

> **Credentials:** My real files contain a throwaway local password. In this README I always write `<YOUR_PASSWORD>`. Never commit real passwords. (Proper handling with Kubernetes Secrets is a future topic.)

### 6.1 PostgreSQL Pod (`BackEnd/kubernetes/Pgsql-pod.yaml`)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: pgsql-pod
  labels:
    app: pgsql
spec:
  containers:
    - name: pgsql-container
      image: postgres:13
      imagePullPolicy: IfNotPresent
      env:
        - name: POSTGRES_USER
          value: "postgres"
        - name: POSTGRES_PASSWORD
          value: "<YOUR_PASSWORD>"
        - name: POSTGRES_DB
          value: "k8_learning"
      ports:
        - containerPort: 5432
```

### 6.2 Backend Pod (`BackEnd/kubernetes/Backend-pod.yaml`)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: backend-pod
  labels:
    app: backend
spec:
  hostNetwork: true
  containers:
    - name: backend-container
      image: k8-backend:v1
      imagePullPolicy: IfNotPresent
      ports:
        - containerPort: 3000
      env:
        - name: DB_HOST
          value: "10.244.0.4"        # the PostgreSQL Pod's IP (yours will differ)
        - name: DB_PORT
          value: "5432"
        - name: DB_USER
          value: "postgres"
        - name: DB_PASSWORD
          value: "<YOUR_PASSWORD>"
        - name: DB_NAME
          value: "k8_learning"
```

### 6.3 Frontend Pod (`FrontEnd/kubernetes/Frontend-pod.yaml`)

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: frontend-pod
  labels:
    app: frontend
spec:
  containers:
    - name: frontend-container
      image: k8-frontend:dev
      imagePullPolicy: IfNotPresent
      tty: true
      ports:
        - containerPort: 5173
```

(My file also has a commented-out `args:` line from an experiment. The Dockerfile's `CMD` already passes `--host 0.0.0.0`, so it isn't needed.)

### Field-by-field

#### `apiVersion: v1`
| | |
|---|---|
| **Meaning** | Which version of the Kubernetes API this object type belongs to. Pods live in the core group, `v1`. |
| **If wrong/omitted** | `kubectl apply` fails (for example "no matches for kind Pod in version ..."). |
| **Required?** | **Required.** |

#### `kind: Pod`
| | |
|---|---|
| **Meaning** | What kind of object to create. |
| **If wrong** | You create a different object, or get "no matches for kind". Later you'll use `Deployment`, `Service`, etc. |
| **Required?** | **Required.** |

#### `metadata.name`
| | |
|---|---|
| **Meaning** | The Pod's unique name (within its namespace). This is what you type in `kubectl logs pgsql-pod`. |
| **Rules** | Lowercase letters, numbers, `-` and `.` only. No underscores or capitals. |
| **If omitted / invalid** | The apply is rejected. |
| **If a Pod with that name exists** | Re-applying updates allowed fields only; most Pod spec fields can't be changed in place. Delete and re-create instead. |
| **Required?** | **Required.** |

#### `metadata.labels`
| | |
|---|---|
| **Meaning** | Key/value tags (`app: backend`). |
| **Why** | Used to group and select objects. E.g. `kubectl get pods -l app=backend`. Services (future topic) find Pods by labels. |
| **If omitted** | The Pod still runs. You just lose easy selection. |
| **Required?** | **Optional** (but very useful later). |

#### `spec`
The "desired state" section: what should run and how.  **Required.**

#### `spec.hostNetwork: true` (backend only)
| | |
|---|---|
| **Meaning** | The Pod uses the **node's** network instead of its own private Pod network. Its port 3000 is then the node's port 3000. |
| **Why I used it** | A shortcut while learning, so the backend is reachable on the node's address without extra objects. |
| **Trade-offs** | Port clashes are possible with anything else on the node using that port. It weakens network isolation. Not a normal practice; Services are the proper approach (future topic). |
| **If omitted** | The Pod gets its own Pod IP (like `10.244.x.x`), which is the normal default. |
| **Required?** | **Optional.** |

#### `spec.containers`
| | |
|---|---|
| **Meaning** | The list of containers in the Pod (note the `-` before each item). |
| **If omitted / empty** | Invalid. A Pod needs at least one container. |
| **Required?** | **Required.** |

#### `containers[].name`
Name of the container inside the Pod (used for `kubectl logs pod -c name` when there are several). **Required.**

#### `containers[].image`
| | |
|---|---|
| **Meaning** | Which image to run: `k8-backend:v1`, `k8-frontend:dev`, `postgres:13`. |
| **If the tag/name is wrong** | `ErrImagePull` / `ImagePullBackOff`. |
| **If the image isn't in Minikube** | Same error. Run `minikube image load`. |
| **Required?** | **Required.** |

#### `containers[].imagePullPolicy: IfNotPresent`
| | |
|---|---|
| **Meaning** | Only download the image if the node doesn't already have it. |
| **Why it matters here** | Our `k8-*` images exist only locally. With `IfNotPresent`, Kubernetes uses the copy you loaded into Minikube instead of looking on the internet. |
| **Other values** | `Always` (always check the registry; will fail for local-only images) and `Never` (never pull; fail if missing). |
| **If omitted** | Default is `IfNotPresent`, **except** when the tag is `latest` (or missing), where the default becomes `Always`. So a local image tagged `:latest` would fail to pull. This is why I use explicit tags like `v1` and `dev`. |
| **Required?** | **Optional.** |

#### `containers[].ports[].containerPort`
| | |
|---|---|
| **Meaning** | The port the app listens on inside the container (3000, 5173, 5432). |
| **Is it informational?** | Mostly yes. Like `EXPOSE`, it documents the port; it doesn't open or restrict anything by itself. |
| **If omitted** | The app still works. It's just undocumented and harder for tools to discover. |
| **If it doesn't match what the app listens on** | Nothing warns you. Connections just fail, which is a sneaky error. |
| **Required?** | **Optional.** |

#### `containers[].env`
| | |
|---|---|
| **Meaning** | Environment variables passed into the container (`name` + `value` pairs). |
| **Why** | Configure the app without rebuilding the image. |
| **If omitted** | The app sees `undefined` for those variables. The PostgreSQL image refuses to start without `POSTGRES_PASSWORD`. |
| **Note** | Values must be strings: write `"5432"` in quotes. |
| **Required?** | Optional by Kubernetes, but **required by the apps** that read them. |

#### `containers[].tty: true` (frontend only)
| | |
|---|---|
| **Meaning** | Allocates a terminal for the container. |
| **Why I used it** | Vite's dev server can exit or behave differently without a TTY in some setups. |
| **If omitted** | Often fine. If the frontend container exits right after start, try adding it. |
| **Required?** | **Optional.** |

### The PostgreSQL environment variables

These are read by the official `postgres` image the **first time** it starts with an empty data folder:

| Variable | What it does | If omitted |
|----------|--------------|------------|
| `POSTGRES_PASSWORD` | Password for the superuser | Container exits with an error (**required**) |
| `POSTGRES_USER` | Name of the superuser | Defaults to `postgres` |
| `POSTGRES_DB` | Creates an initial database with this name | Defaults to the value of `POSTGRES_USER` (so `k8_learning` would **not** exist) |

> If the data folder already has data, these variables are **ignored**. They only run on first initialization.

### The backend environment variables

| YAML name | Meaning | Value in my setup |
|-----------|---------|-------------------|
| `DB_HOST` | Where PostgreSQL is | The PostgreSQL Pod's IP |
| `DB_PORT` | PostgreSQL port | `5432` |
| `DB_USER` | Database user | `postgres` (match `POSTGRES_USER`) |
| `DB_PASSWORD` | Database password | match `POSTGRES_PASSWORD` |
| `DB_NAME` | Database name | `k8_learning` (match `POSTGRES_DB`) |

> ⚠️ **Known mismatch in my code (to fix):** `BackEnd/migrate.js` reads `DB_NAME` and `DB_USER`, but `BackEnd/src/db.js` (used by the API) reads `DB_DATABASE` and `DB_USERNAME`, and my local `.env` uses the latter names. My Pod YAML sets `DB_USER`/`DB_NAME`. As written, the API inside the Pod would not receive a database name or user. The fix is to make the code and YAML use the same names, e.g. rename the YAML variables to `DB_DATABASE` and `DB_USERNAME` (or change `db.js`). Variable names must match **exactly**.

---

## 7. Commands explained

> Commands are listed from my practice. I have not re-run each one while writing this README, so treat sample outputs as examples.

### 7.1 Docker

| Command | What it does | Notes / common errors |
|---------|--------------|-----------------------|
| `docker build -t k8-backend:v1 .` | Builds an image from the Dockerfile in `.` | `-t` = name:tag. Error `no such file: Dockerfile` → wrong folder. `npm ci` failing → lock file out of sync. |
| `docker images` | Lists local images | Check name and tag spelling here before writing YAML. |
| `docker pull postgres:13` | Downloads an image from Docker Hub | `permission denied ... docker.sock` → add your user to the `docker` group (see [Minikube setup](#5-minikube-setup-ubuntu)). |
| `docker ps` | Lists running containers | Add `-a` to include stopped ones. |
| `docker rmi k8-backend:v1` | Deletes a local image | Fails if a container still uses it. |

### 7.2 Minikube

| Command | What it does | Notes / common errors |
|---------|--------------|-----------------------|
| `minikube start --driver=docker` | Creates/starts the cluster as a Docker container | `--driver=docker` picks how the VM/node is made. Errors usually mean Docker isn't running or no permissions. |
| `minikube status` | Shows whether the cluster components are running | `Stopped` → run `minikube start`. |
| `minikube image load k8-backend:v1` | Copies a local image into the cluster | Must be repeated after every rebuild. |
| `minikube image ls` | Lists images known to the cluster | Use to confirm the load worked. |
| `minikube stop` / `minikube delete` | Pause / destroy the cluster | `delete` erases all Pods and data. |

### 7.3 kubectl

| Command | What it does | Notes / common errors |
|---------|--------------|-----------------------|
| `kubectl apply -f backend-pod.yaml` | Creates (or updates) what the file describes | Use your real path, e.g. `BackEnd/kubernetes/Backend-pod.yaml`. YAML indentation errors are common: use spaces, never tabs. |
| `kubectl get pods` | Lists Pods and their status | Statuses: `Pending`, `ContainerCreating`, `Running`, `Completed`, `CrashLoopBackOff`, `ErrImagePull`, `ImagePullBackOff`. |
| `kubectl get pods -o wide` | Same, plus Pod IP and node | `-o wide` shows the **IP** I used for `DB_HOST`. |
| `kubectl describe pod backend-pod` | Detailed report with an **Events** list at the bottom | First place to look when a Pod won't start. |
| `kubectl logs backend-pod` | Prints the container's output (stdout/stderr) | `-f` follows live. `--previous` shows logs of the last crashed run. `-c <name>` selects a container in multi-container Pods. |
| `kubectl exec -it pgsql-pod -- psql -U postgres -d k8_learning` | Runs `psql` inside the PostgreSQL container | `-i` keeps input open, `-t` gives a terminal, `--` separates kubectl flags from the command. |
| `kubectl delete pod backend-pod` | Removes a Pod | A bare Pod is **not** recreated (no controller manages it). |
| `kubectl delete -f backend-pod.yaml` | Removes whatever the file defines | |

> My PostgreSQL Pod is named **`pgsql-pod`** in the YAML, so use that name in commands. Use whatever `metadata.name` your file has.

### Useful `psql` commands (inside the PostgreSQL Pod)

```bash
kubectl exec -it pgsql-pod -- psql -U postgres -d k8_learning
```

| `psql` command | Meaning |
|----------------|---------|
| `\l` | List databases |
| `\c k8_learning` | Connect to a database |
| `\dt` | List tables |
| `\d products` | Describe a table |
| `SELECT * FROM products;` | Read rows |
| `\q` | Quit |

---

## 8. Kubernetes architecture: control plane and worker nodes

A **cluster** is a group of machines (**nodes**). There are two roles:

- The **control plane** (older name: "master node") is the brain. It decides and records what should run.
- **Worker nodes** are the muscle. They actually run your Pods.

### Components

#### Control plane

| Component | Job (simple English) |
|-----------|----------------------|
| **API server** (`kube-apiserver`) | The front door. Every request (from `kubectl` or other components) goes through it. It checks and validates requests. |
| **etcd** | The cluster's database. Stores all desired and current state ("Pod X should exist"). Only the API server talks to it directly. |
| **Scheduler** (`kube-scheduler`) | Picks which node a new Pod should run on, based on available resources and rules. |
| **Controller manager** (`kube-controller-manager`) | Runs controller loops that compare *desired* state with *actual* state and fix differences (for example, keep the right number of replicas). |

#### Worker node

| Component | Job |
|-----------|-----|
| **kubelet** | The node's agent. Watches the API server for Pods assigned to its node and makes sure those containers are running and healthy. |
| **Container runtime** | The software that really starts containers (containerd, CRI-O; in Minikube with the docker driver, commonly containerd or Docker Engine depending on the version/config). |
| **kube-proxy** | Handles network rules on the node so Services can route traffic to Pods. *I haven't used Services yet, so this is background only.* |
| **Pods** | Your containers. |

### Diagram

```text
                        YOU
                         │  kubectl apply -f backend-pod.yaml
                         ▼
┌────────────────────── CONTROL PLANE ───────────────────────┐
│                                                             │
│   ┌───────────────┐  read/write  ┌──────────┐              │
│   │  API server   │◄────────────►│   etcd   │              │
│   └──▲────▲────▲──┘              └──────────┘              │
│      │    │    │                                           │
│  ┌───┴──┐ │ ┌──┴────────────────────┐                      │
│  │Sched-│ │ │ Controller manager    │                      │
│  │ uler │ │ │ (desired vs actual)   │                      │
│  └──────┘ │ └───────────────────────┘                      │
└───────────┼─────────────────────────────────────────────────┘
            │ "Pod assigned to your node"
┌───────────▼───────────── WORKER NODE ───────────────────────┐
│   ┌──────────┐  tells   ┌──────────────────┐                │
│   │ kubelet  │────────► │ container runtime │               │
│   └──────────┘          └────────┬─────────┘                │
│   ┌────────────┐                 ▼                          │
│   │ kube-proxy │      ┌────────┐ ┌────────┐ ┌────────┐      │
│   └────────────┘      │frontend│ │backend │ │ pgsql  │      │
│                       │  Pod   │ │  Pod   │ │  Pod   │      │
│                       └────────┘ └────────┘ └────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### What happens when I run `kubectl apply -f backend-pod.yaml`

1. `kubectl` reads the YAML and sends it to the **API server**.
2. The API server validates it and stores the Pod in **etcd** (state: no node assigned yet, so `Pending`).
3. The **scheduler** notices an unassigned Pod, chooses a node, and tells the API server.
4. The API server records the assignment in etcd.
5. The **kubelet** on that node notices "a Pod is assigned to me".
6. The kubelet asks the **container runtime** to get the image (using the local one if `imagePullPolicy: IfNotPresent` and it's present) and start the container.
7. The kubelet reports status back to the API server. `kubectl get pods` now shows `Running`.

Every component talks **through the API server**; they don't call each other directly.

### Minikube is a single-node cluster

In real clusters, the control plane and workers are separate machines. Minikube normally creates **one node** that plays both roles: the API server, etcd, scheduler and your Pods all live on the same `minikube` node. That's why `kubectl get nodes` shows just one, and `minikube status` says `type: Control Plane`. This keeps learning simple and uses less memory. You can see the control-plane components running as Pods with:

```bash
kubectl get pods -n kube-system
```

---

## 9. Frontend, backend and PostgreSQL communication

### Big picture

```text
 Browser (my computer)
     │  http://localhost:3000/api/products   (this is what App.jsx calls)
     ▼
┌──────────────┐   DB_HOST:5432    ┌──────────────┐
│ backend-pod  │ ────────────────► │  pgsql-pod   │
│ Node/Express │  (PostgreSQL      │ postgres:13  │
│  port 3000   │   protocol)       │  port 5432   │
└──────────────┘                   └──────────────┘
┌──────────────┐
│ frontend-pod │  serves the React app on port 5173
│ Vite         │
└──────────────┘
```

Important: the **React code runs in the browser**, not inside the frontend Pod. The Pod only serves the files. So when `App.jsx` calls `http://localhost:3000/api/products`, `localhost` means **the computer running the browser**. For that to work, port 3000 of the backend has to be reachable from my machine. How I reach the Pods from my machine (for instance with `kubectl port-forward` or a Minikube-specific route) is something I'm still working out, and I don't claim a verified recipe here. Proper Services are the next step.

### Docker image vs Kubernetes Pod (recap)

| | Image | Pod |
|---|-------|-----|
| What | A package on disk | A running thing in the cluster |
| Made by | `docker build` | `kubectl apply` |
| Changes by | Rebuild with a new tag | Delete & re-create (Pods are mostly immutable) |

### Why `localhost` can't reach another Pod

Each Pod has its own network space. Inside the backend Pod, `localhost` (127.0.0.1) means *the backend Pod itself*. PostgreSQL is in a different Pod, so `DB_HOST=localhost` fails with `ECONNREFUSED 127.0.0.1:5432`. The backend must use something that points at the other Pod: its Pod IP (what I'm doing now) or, better, a Service name (future topic).

Get the Pod IP:

```bash
kubectl get pods -o wide
```

Put it in `DB_HOST`. 

**Weakness:** Pod IPs change when a Pod is re-created, so hard-coding `10.244.0.4` breaks later. That is the exact problem Services solve.

### Why my local PostgreSQL data is not in the Pod

The `postgres:13` Pod is a brand-new, empty database server. It is completely separate from any PostgreSQL installed on my computer. The only things it has are what the env vars create (the `k8_learning` database, the `postgres` user). **No tables exist until I create them.**

### Setting up the tables

The SQL files are in the repo. One way to run them is to pipe them into `psql` inside the Pod:

```bash
# Create the table
kubectl exec -i pgsql-pod -- psql -U postgres -d k8_learning \
  < BackEnd/database/migrations/001_create_products.sql

# Insert the sample rows
kubectl exec -i pgsql-pod -- psql -U postgres -d k8_learning \
  < BackEnd/database/seeders/001_seed_products.sql
```

(`-i` without `-t` because we're piping a file in, not typing.) Another way is `node migrate.js` from my machine, which needs the DB to be reachable from there.

### Verifying

```bash
kubectl get pods -o wide                     # Pod status + IPs
kubectl logs pgsql-pod                       # DB startup messages
kubectl logs backend-pod                     # "Product API running on port 3000"
kubectl exec -it pgsql-pod -- psql -U postgres -d k8_learning -c '\dt'
kubectl exec -it pgsql-pod -- psql -U postgres -d k8_learning -c 'SELECT * FROM products;'
```

### Why data can be lost

Inside a container, files live in a writable layer that belongs to *that* container. When the Pod is deleted and re-created, the PostgreSQL container starts from the clean image again: **empty data, tables gone**, and `POSTGRES_*` variables initialize it from scratch. My setup has no persistent storage, so anything I insert is temporary. Persistent storage (PersistentVolumes / PersistentVolumeClaims) is a future topic, and I haven't implemented it.

---

## 10. Troubleshooting

First, always run these two:

```bash
kubectl get pods
kubectl describe pod <pod-name>     # read the Events section at the bottom
kubectl logs <pod-name>
```

| Symptom | What it means | Fix |
|---------|---------------|-----|
| **`ErrImagePull`** | Kubernetes tried to download the image and failed. | Read the Events from `describe`. Usually the name/tag is wrong, or the image is local-only and not in Minikube. |
| **`ImagePullBackOff`** | Same problem; Kubernetes is waiting longer between retries. | Fix the cause (below), delete the Pod, and apply again. |
| **Wrong image tag** | YAML says `k8-backend:v1` but you built `k8-backend:v2` (or a typo). | Compare `docker images` with the `image:` line. Fix whichever is wrong. |
| **Image not loaded into Minikube** | Image exists on your PC only. | `minikube image load k8-backend:v1`, then `minikube image ls` to confirm. |
| **Used `:latest` unintentionally** | Default pull policy becomes `Always`. | Use an explicit tag and `imagePullPolicy: IfNotPresent`. |
| **`Pending`** | Not scheduled, or still waiting for the image. | `describe` shows why (for example not enough CPU/memory, or `hostNetwork` port conflict). Check `minikube status` and node resources. |
| **`ContainerCreating` for a long time** | Pulling a big image (like `postgres:13`) or a runtime problem. | Wait, then check `describe` events. |
| **`CrashLoopBackOff`** | The container starts, crashes, and Kubernetes keeps retrying. | `kubectl logs <pod> --previous`. Typical causes: missing env var (Postgres without `POSTGRES_PASSWORD`), app error, wrong `CMD`, missing `node_modules`. |
| **Frontend Pod `Running` but page unreachable** | Dev server only listening on `localhost` inside the container. | Make sure the command includes `--host 0.0.0.0`, and that you're reaching the Pod correctly from outside. |
| **Database/table missing** (`database "x" does not exist`, `relation "products" does not exist`) | Nothing created it. `POSTGRES_DB` only runs on first init, and tables are never auto-created. | Check `\l` and `\dt`. Run the migration and seed SQL ([section 9](#setting-up-the-tables)). If you changed `POSTGRES_DB` after first start, delete and re-create the Pod. |
| **Backend can't connect** (`ECONNREFUSED`, `password authentication failed`, timeouts) | Wrong host, port, user or password; DB Pod not ready; DB Pod got a new IP. | 1) `kubectl get pods -o wide` and compare the IP with `DB_HOST`. 2) Match creds with `POSTGRES_*`. 3) Make sure the variable names the code reads exist in the YAML (see the mismatch note in [section 6](#the-backend-environment-variables)). 4) `kubectl logs backend-pod`. |
| **Backend returns 500 on `/api/products`** | Usually a DB error (missing table, bad connection). The error handler hides details from the client. | The real message is in `kubectl logs backend-pod`. |
| **Changed code but nothing changed** | The Pod still runs the old image. | Rebuild, `minikube image load`, delete the Pod, `kubectl apply` again. |
| **`minikube start` errors** | Docker not running, no permission, or too little memory. | `docker ps` to check Docker. Fix the `docker` group membership. Try `minikube delete` then `minikube start --driver=docker`. Read the message; it usually names the cause. |
| **`kubectl` can't connect to server** | Cluster stopped. | `minikube status`, then `minikube start`. |
| **YAML errors on apply** | Indentation or a tab character. | Use 2 spaces. Compare against the examples above. |

Re-creating a Pod after fixing a problem:

```bash
kubectl delete pod backend-pod
kubectl apply -f BackEnd/kubernetes/Backend-pod.yaml
```

### Housekeeping to fix in this repo

- `BackEnd/.gitignore` is currently empty, so `BackEnd/.env` can end up committed. Add `.env` and `node_modules/` to it.
- There is no root `.gitignore`, so `PythonBackEnd/.venv/` and `__pycache__/` show up as untracked files. Ignore them.
- Replace any real passwords in YAML/`.env` with placeholders before pushing, and rotate any password that has already been committed.

---

## 11. What I have learned

- Writing Dockerfiles and what each instruction does (`FROM`, `WORKDIR`, `COPY`, `RUN`, `EXPOSE`, `CMD`).
- Images vs containers vs tags; building with `docker build`, listing with `docker images`, pulling with `docker pull`.
- Installing and starting Minikube on Ubuntu with the Docker driver.
- Why local images must be loaded into Minikube (`minikube image load`).
- Writing Pod YAML for a frontend, a backend and PostgreSQL.
- Passing configuration with `env`.
- Managing Pods with `kubectl apply`, `get`, `describe`, `logs`, `exec`, `delete`.
- Diagnosing `ErrImagePull` and `ImagePullBackOff`.
- Setting up a basic PostgreSQL database and pointing the backend at it.
- The basic Kubernetes architecture (control plane, worker node) and the flow of a `kubectl apply`.
- Why `localhost` doesn't reach other Pods, and why data disappears without persistent storage.

## 12. What I plan to learn next

These are **not done yet**; they are my to-do list.

- [ ] **Services**: stable names/addresses so the backend doesn't need a hard-coded Pod IP, and a proper way to reach the frontend and backend.
- [ ] **Deployments**: self-healing Pods, replicas, rolling updates.
- [ ] **ConfigMaps**: move non-secret settings out of the Pod YAML.
- [ ] **Secrets**: store the database password safely.
- [ ] **Persistent storage** (PersistentVolume / PersistentVolumeClaim): keep PostgreSQL data across Pod restarts.
- [ ] **Ingress**: route outside traffic to the frontend and backend.
- [ ] Add a `.dockerignore`, and production-style images (no dev server).
- [ ] Health checks (liveness / readiness probes) using the backend's `/health` endpoint.
- [ ] Fix the env variable name mismatch between `db.js`, `migrate.js` and the Pod YAML.

---

*This README is a living journal. Add new sections as I learn.*
