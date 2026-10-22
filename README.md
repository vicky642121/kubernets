# Docker & Kubernetes Learning Journal

A beginner's journal of learning **Docker** and **Kubernetes (Minikube)** by running a small three-part app (React frontend, Node.js backend, PostgreSQL database) as plain Pods first, then as **Deployments** with **Services**, on a local cluster.

> **About accuracy:** The files and commands below come from my own project and practice. Parts that are general background (for example, the architecture section) are explained from standard Kubernetes concepts. Where something is a known weakness in my setup, I say so. Output samples are illustrative, not pasted from a verified run.

---

## Table of Contents

1. [Project overview and prerequisites](#1-project-overview-and-prerequisites)
2. [Project structure](#2-project-structure)
3. [Docker fundamentals and Dockerfile explanation](#3-docker-fundamentals-and-dockerfile-explanation)
4. [Building and loading images](#4-building-and-loading-images)
5. [Minikube setup (Ubuntu)](#5-minikube-setup-ubuntu)
6. [Pod YAML files explained line by line](#6-pod-yaml-files-explained-line-by-line)
   - [6b. Deployment YAML files (Pod → Deployment)](#6b-deployment-yaml-files-pod--deployment)
   - [6c. Service YAML files](#6c-service-yaml-files)
   - [6d. ConfigMap YAML file](#6d-configmap-yaml-file)
   - [6e. Secret YAML file](#6e-secret-yaml-file)
   - [6f. Namespace YAML file](#6f-namespace-yaml-file)
   - [6g. PersistentVolume and PersistentVolumeClaim](#6g-persistentvolume-and-persistentvolumeclaim)
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
│   │   └── seeders/001_seed_products.sql        # inserts 8 sample rows
│   └── kubernetes/
│       ├── Backend-pod.yaml
│       ├── Backend-deployment.yaml      # backend; settings from ConfigMap + Secret
│       ├── Backend-service.yaml         # ClusterIP, port 3000
│       ├── Backend-config.yaml          # ConfigMap: DB_HOST, DB_PORT, DB_NAME (6d)
│       ├── Backend-secret.yaml          # Secret: DB_USER, DB_PASSWORD (6e)
│       ├── Pgsql-pod.yaml
│       ├── Pgsql-deployment.yaml        # standalone PostgreSQL Deployment (mounts the PVC)
│       ├── pv.yaml                      # PersistentVolume backend-pv, 300Mi hostPath (6g)
│       ├── pvc.yaml                     # PersistentVolumeClaim backend-pvc (6g)
│       ├── Pgsql-service.yaml           # ClusterIP "pgsql-service", port 5432
│       └── namespace/
│           ├── Backend-namespace.yaml   # Namespace backend-copy-namespace (6f)
│           └── Backend-deploymentcopy.yaml  # backend Deployment inside that namespace
├── FrontEnd/
│   ├── Dockerfile                       # recipe for k8-frontend:dev
│   ├── src/App.jsx                      # fetches the products
│   └── kubernetes/
│       ├── Frontend-pod.yaml
│       ├── Frontend-deployment.yaml
│       └── Frontend-service.yaml        # ClusterIP, 8080 → 5173
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

## 6b. Deployment YAML files (Pod → Deployment)

A bare Pod is never recreated if it dies. A **Deployment** fixes that: it describes the Pod I want (a *template*) and how many copies (*replicas*). A controller then keeps that many Pods running, recreates them if they crash or are deleted, and handles rolling updates.

```text
Deployment  →  ReplicaSet  →  Pod(s)  →  container(s)
```

I now have three Deployment files next to the Pod files:

| File | Deployment name | What it runs |
|------|-----------------|--------------|
| `FrontEnd/kubernetes/Frontend-deployment.yaml` | `frontend-deployment` | `vigneshpandianv/k8-frontend:dev` on 5173 |
| `BackEnd/kubernetes/Backend-deployment.yaml` | `backend-deployment` | **two containers in one Pod**: the backend + `postgres:13` |
| `BackEnd/kubernetes/Pgsql-deployment.yaml` | `pgsql-deployment` | `postgres:13` alone (not used, see below) |

### 6b.1 Frontend Deployment

```yaml
apiVersion: apps/v1          # Deployments live in the "apps/v1" API group (Pods are plain "v1")
kind: Deployment
metadata:
  name: frontend-deployment  # name of the Deployment itself
  labels:
    app: frontend            # label on the Deployment object
spec:
  replicas: 1                # how many Pods to keep running
  selector:
    matchLabels:
      app: frontend          # "manage Pods that have this label"
  template:                  # the Pod blueprint, same content as a Pod's metadata + spec
    metadata:
      labels:
        app: frontend        # MUST match selector.matchLabels
    spec:
      containers:
        - name: frontend-container
          image: vigneshpandianv/k8-frontend:dev
          imagePullPolicy: IfNotPresent
          tty: true
          ports:
            - containerPort: 5173
```

**What's new compared with a Pod file:**

| Field | Meaning |
|-------|---------|
| `kind: Deployment`, `apiVersion: apps/v1` | The object type and its API group. |
| `spec.replicas` | Desired number of Pods. Change to `3` and apply to scale. |
| `spec.selector.matchLabels` | How the Deployment finds the Pods it owns. |
| `spec.template` | Everything under it is the old Pod YAML (`metadata.labels` + `spec.containers`). |
| Label match rule | `selector.matchLabels` **must equal** `template.metadata.labels`, otherwise `apply` is rejected. |
| Pod names | Generated: `frontend-deployment-<replicaset-hash>-<random>`. You no longer pick the Pod name. |

### 6b.2 Backend Deployment (backend + PostgreSQL in one Pod)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend-deployment
  labels:
    app: backend
spec:
  replicas: 1
  selector:
    matchLabels:
      app: backend
  template:
    metadata:
      labels:
        app: backend
    spec:
      containers:
        - name: backend-container
          image: vigneshpandianv/k8-backend:v2
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 3000
          env:
            - name: DB_HOST
              value: "127.0.0.1"          # same Pod = same network, so localhost works
            - name: DB_PORT
              value: "5432"
            - name: DB_USER
              value: "postgres"
            - name: DB_PASSWORD
              value: "<YOUR_PASSWORD>"
            - name: DB_NAME
              value: "k8_learning"
        - name: pgsql-container           # second container in the SAME Pod
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

**Why PostgreSQL is inside the backend Deployment.** With separate Pods, the database Pod gets a new IP every time it is recreated, so a hard-coded `DB_HOST` breaks (the weakness in [section 9](#9-frontend-backend-and-postgresql-communication)). Containers in the **same Pod share one network namespace**, so the backend reaches PostgreSQL on `127.0.0.1:5432`. That was my first design. **Later I moved PostgreSQL back out** into `Pgsql-deployment.yaml` and put a `pgsql-service` in front of it, so its changing Pod IP no longer matters (see [6c](#where-i-use-a-service-name-instead-of-127001) and [6d](#6d-configmap-yaml-file)).

**Trade-offs of this shortcut** (fine for learning, not for real systems):

- The DB and the backend live and die together, so `replicas: 2` would give two *separate, empty* databases.
- There is no volume, so the data is lost whenever the Pod is recreated.
- The proper fix is a separate PostgreSQL Deployment plus a **Service** (stable name) and a PersistentVolumeClaim. I did this later: see [6c](#6c-service-yaml-files) and [6g](#6g-persistentvolume-and-persistentvolumeclaim).

### 6b.3 Commands for Deployments

```bash
kubectl apply -f BackEnd/kubernetes/Backend-deployment.yaml
kubectl apply -f FrontEnd/kubernetes/Frontend-deployment.yaml

kubectl get deployments                       # READY shows 1/1 when the Pod is up
kubectl get pods -l app=backend               # Pods owned by the backend Deployment
kubectl describe deployment backend-deployment
kubectl logs deploy/backend-deployment -c backend-container   # -c is needed: 2 containers
kubectl scale deployment frontend-deployment --replicas=3
kubectl rollout status deployment backend-deployment
kubectl rollout undo deployment backend-deployment            # go back one version
kubectl delete -f BackEnd/kubernetes/Backend-deployment.yaml
```

**Self-healing demo:** delete the Pod and watch a new one appear.

```bash
kubectl delete pod -l app=frontend
kubectl get pods -w          # a new frontend-deployment-... Pod is created automatically
```

### 6b.4 Loading data into the PostgreSQL container

Pod names are generated now, so look the name up first and choose the container with `-c`:

```bash
POD=$(kubectl get pod -l app=backend -o jsonpath='{.items[0].metadata.name}')

# Create the table
kubectl exec -i $POD -c pgsql-container -- psql -U postgres -d k8_learning \
  < BackEnd/database/migrations/001_create_products.sql

# Insert the 3 sample rows
kubectl exec -i $POD -c pgsql-container -- psql -U postgres -d k8_learning \
  < BackEnd/database/seeders/001_seed_products.sql

# Check
kubectl exec -it $POD -c pgsql-container -- psql -U postgres -d k8_learning -c "SELECT * FROM products;"
```

Run these again after the Pod is recreated, because the data is not persistent.

### Pod vs Deployment

| | Pod | Deployment |
|---|-----|-----------|
| Recreated if it dies | No | Yes |
| Scale to N copies | No | `replicas: N` |
| Rolling update / rollback | No | Yes |
| Pod name | You choose | Generated |
| Delete Pod by name | Gone for good | Replaced by a new one |
| To stop it | `kubectl delete pod x` | `kubectl delete deployment x` (deleting the Pod just recreates it) |

---

## 6c. Service YAML files

Pod IPs change every time a Pod is recreated, so nothing should depend on them. A **Service** gives a group of Pods one **stable IP and DNS name**, and load-balances across them. It finds its Pods with a **label selector**, the same labels my Deployments put on their Pods.

```text
client → Service (stable name + ClusterIP) → selector app=backend → Pod(s) (IPs may change)
```

I have two Services:

| File | Service name | Type | Port → targetPort | Selects Pods with |
|------|--------------|------|-------------------|-------------------|
| `BackEnd/kubernetes/Backend-service.yaml` | `backend-service` | `ClusterIP` | 3000 → 3000 | `app: backend` |
| `FrontEnd/kubernetes/Frontend-service.yaml` | `frontend-service` | `ClusterIP` (default) | 8080 → 5173 | `app: frontend` |

### 6c.1 Backend Service

```yaml
apiVersion: v1                # Services are in the core "v1" group
kind: Service
metadata:
  name: backend-service       # becomes the DNS name inside the cluster
  labels:
    app: backend              # label on the Service object itself (not used for routing)
spec:
  type: ClusterIP             # reachable only from inside the cluster
  selector:
    app: backend              # send traffic to Pods that have this label
  ports:
    - port: 3000              # port the Service listens on
      targetPort: 3000        # port on the Pod's container to forward to
      protocol: TCP
```

### 6c.2 Frontend Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: frontend-service
  labels:
    app: frontend
spec:
  selector:
    app: frontend
  ports:
    - protocol: TCP
      port: 8080              # Service port (what clients use)
      targetPort: 5173        # Vite dev server port in the container
```

There is no `type:`, so it defaults to `ClusterIP`.

### Field-by-field

| Field | Meaning |
|-------|---------|
| `selector` | Which Pods receive traffic. It must match the **Pod** labels (`template.metadata.labels` in the Deployment), not the Deployment's own labels. If nothing matches, the Service has no endpoints. |
| `port` | The port the **Service** exposes. |
| `targetPort` | The port the **container** listens on (`containerPort`). It can differ from `port`, as in the frontend (8080 → 5173). |
| `protocol` | `TCP` (default). |
| `type` | How the Service is exposed (below). |

### Service types

| Type | Reachable from | Use |
|------|----------------|-----|
| `ClusterIP` (default) | Inside the cluster only | Pod-to-pod traffic, e.g. frontend → backend. |
| `NodePort` | Outside, at `<node-ip>:<30000-32767>` | Simple access from my machine. |
| `LoadBalancer` | Outside, via a cloud load balancer (on Minikube: `minikube tunnel`) | Cloud setups. |

Both my Services are `ClusterIP`, so they can't be opened from my browser directly. I use `kubectl port-forward` for testing (below). `NodePort` or Ingress is what's needed for real outside access.

### 6c.3 Commands for Services

```bash
kubectl apply -f BackEnd/kubernetes/Backend-service.yaml
kubectl apply -f FrontEnd/kubernetes/Frontend-service.yaml

kubectl get svc                          # shows CLUSTER-IP and PORT(S)
kubectl describe svc backend-service     # check the Endpoints line
kubectl get endpoints backend-service    # the Pod IP:port the Service points at

# Reach a ClusterIP Service from my machine (keep the terminal open)
kubectl port-forward svc/backend-service 3000:3000
curl http://localhost:3000/api/products

kubectl port-forward svc/frontend-service 8080:8080
# then open http://localhost:8080
```

**Test the DNS name from inside the cluster:**

```bash
kubectl run curl-test --rm -it --image=curlimages/curl --restart=Never -- \
  curl http://backend-service:3000/health
```

Inside the cluster, `backend-service` resolves to the Service IP. The full name is `backend-service.<namespace>.svc.cluster.local` (here `backend-service.default.svc.cluster.local`).

### How a Service fixes the IP problem

- The Service IP stays the same while the Pod IP changes. Delete the backend Pod and a new one gets a new IP, but `backend-service` still works.
- `kubectl describe svc` shows `Endpoints:`. If it says `<none>`, the selector doesn't match any ready Pod. Compare `kubectl get pods --show-labels` with the `selector`.
- Services also load-balance: with `replicas: 3` the traffic is spread across the 3 Pods.

### Where I use a Service name instead of `127.0.0.1`

In the Pod version, the backend reached PostgreSQL on `127.0.0.1` because PostgreSQL was a container **inside the backend Pod** (see [6b.2](#6b2-backend-deployment-backend--postgresql-in-one-pod)). I have now split PostgreSQL into its own Deployment (`Pgsql-deployment.yaml`) with its own `pgsql-service` (`Pgsql-service.yaml`, `ClusterIP`, port 5432), and the backend uses `DB_HOST: pgsql-service` from the ConfigMap (see [6d](#6d-configmap-yaml-file)).

### Common Service problems

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Endpoints: <none>` | Selector doesn't match the Pod labels. | Fix `selector` or the Pod template labels. |
| Connection refused through the Service | `targetPort` is not the port the app listens on. | Match `targetPort` to the container port (3000 / 5173). |
| Can't open the Service in the browser | It is `ClusterIP`. | Use `port-forward`, or change to `NodePort` (`minikube service frontend-service --url`). |
| Works by Pod IP, not by name | Wrong Service name or namespace. | `kubectl get svc`, and use the exact name. |

---

## 6d. ConfigMap YAML file

### Why I use a ConfigMap

At first I wrote the database settings straight into each Pod/Deployment under `env:`. That has problems:

- The same values (`DB_HOST`, `DB_USER`, ...) were repeated in several files, and they get out of sync.
- Changing one value meant editing the Deployment YAML itself.
- The file grows messy as more settings are added.

A **ConfigMap** is a separate Kubernetes object that holds key/value settings. Deployments just *refer* to it, so the settings live in **one place**. The app code stays the same, and the same image can run with different settings.

```text
Backend-config.yaml (ConfigMap)  ──►  Backend-deployment.yaml   (envFrom)
                                 └─►  Pgsql-deployment.yaml     (env + configMapKeyRef)
```

### My ConfigMap (`BackEnd/kubernetes/Backend-config.yaml`)

```yaml
apiVersion: v1                # ConfigMap is in the core "v1" group
kind: ConfigMap
metadata:
  name: backend-config        # the name other files use to refer to it
data:                         # plain key: value pairs (all values are strings)
  DB_HOST: "pgsql-service"    # the Service name of PostgreSQL, not an IP
  DB_NAME: "k8_learning"
  DB_PORT: "5432"
  # DB_USER and DB_PASSWORD were here at first. I later moved them to a Secret (see 6e).
```

> **Update:** `DB_USER` and `DB_PASSWORD` are now commented out of this file and live in a **Secret** ([6e](#6e-secret-yaml-file)). The rest of this section shows the first version, where all five keys were in the ConfigMap, because that is how I learned `envFrom` and `configMapKeyRef`.

### Using it in the backend: `envFrom`

```yaml
envFrom:
  - configMapRef:
      name: backend-config
```

`envFrom` turns **every key** in the ConfigMap into an environment variable with the **same name** (`DB_HOST`, `DB_PORT`, ...). This is what replaced the long `env:` list.

### Using it in PostgreSQL: `configMapKeyRef`

The official `postgres` image does **not** read `DB_USER` / `DB_PASSWORD` / `DB_NAME`. It only reads `POSTGRES_USER`, `POSTGRES_PASSWORD` and `POSTGRES_DB`. So here I pick single keys and give them the name Postgres expects:

```yaml
env:
  - name: POSTGRES_USER
    valueFrom:
      configMapKeyRef:
        name: backend-config   # which ConfigMap
        key: DB_USER           # which key inside it
  - name: POSTGRES_PASSWORD
    valueFrom:
      configMapKeyRef:
        name: backend-config
        key: DB_PASSWORD
  - name: POSTGRES_DB
    valueFrom:
      configMapKeyRef:
        name: backend-config
        key: DB_NAME
```

| Way | Use it when |
|-----|-------------|
| `envFrom` + `configMapRef` | The variable names in the ConfigMap are already what the app wants (my backend). |
| `env` + `valueFrom.configMapKeyRef` | I need one key only, or need a **different variable name** (PostgreSQL). |

### The mistake I made

First, `Pgsql-deployment.yaml` used `envFrom: backend-config`. The Postgres Pod crashed with:

```text
Database is uninitialized and superuser password is not specified.
You must specify POSTGRES_PASSWORD to a non-empty value for the superuser.
```

**Cause:** the ConfigMap only has `DB_*` keys, so Postgres never got `POSTGRES_PASSWORD`. **Fix:** map the keys with `configMapKeyRef` as shown above. The lesson: `envFrom` copies names exactly, so the names in the ConfigMap must match what the container reads.

### Important notes

- **Create the ConfigMap first.** If a Pod refers to a ConfigMap that doesn't exist, it stays in `CreateContainerConfigError`.
- **Changing a ConfigMap does not update running Pods.** Environment variables are read only when the container starts. After editing, run `kubectl apply -f Backend-config.yaml` and then `kubectl rollout restart deployment backend-deployment` (and the same for `pgsql-deployment`). *(I first thought no restart was needed. That is wrong for env variables.)*
- **A ConfigMap is not secret.** The values are stored as plain text, so anything sensitive (the password) belongs in a **Secret**. That is exactly why I moved `DB_USER` / `DB_PASSWORD` out (see [6e](#6e-secret-yaml-file)).
- A changed `POSTGRES_PASSWORD` has no effect on a database that already exists on disk. It is only used when the database is first created.

### Commands for ConfigMaps

```bash
kubectl apply -f BackEnd/kubernetes/Backend-config.yaml   # create / update
kubectl get configmap                                      # list
kubectl describe configmap backend-config                  # show the keys and values
kubectl get configmap backend-config -o yaml               # full YAML
kubectl exec deploy/backend-deployment -- env | grep DB_   # check what the Pod really received
kubectl rollout restart deployment backend-deployment      # make Pods pick up changes
```

### How the pieces connect now

```text
backend Pod ──DB_HOST=pgsql-service──► pgsql-service (ClusterIP :5432) ──► pgsql Pod (postgres:13)
      ▲                                                                         ▲
      └──────────────── both read their settings from ConfigMap backend-config ─┘
```

---

## 6e. Secret YAML file

### Why I use a Secret

A ConfigMap is plain text: anyone who can read the cluster objects can read `DB_PASSWORD`. A **Secret** is the same idea (key/value settings that Pods consume as environment variables), but it is meant for sensitive data. Kubernetes handles it more carefully (separate permissions with RBAC, not shown in `kubectl describe`, can be encrypted at rest). So:

| Goes in the ConfigMap (not sensitive) | Goes in the Secret (sensitive) |
|---------------------------------------|--------------------------------|
| `DB_HOST`, `DB_PORT`, `DB_NAME` | `DB_USER`, `DB_PASSWORD` |

### My Secret (`BackEnd/kubernetes/Backend-secret.yaml`)

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: backend-secret
type: Opaque                  # generic key/value secret
stringData:                   # I write plain text here; Kubernetes stores it base64-encoded
  DB_USER: "postgres"
  DB_PASSWORD: "Cloud@123"
```

- `stringData` lets me write normal text. With `data:` I would have to base64-encode each value myself.
- **Base64 is not encryption.** `kubectl get secret backend-secret -o yaml` shows base64 values, and `echo <value> | base64 -d` reveals them. The real protection is access control, and never committing real passwords to Git.

### Using the ConfigMap and the Secret together

The backend now needs values from two objects, so I replaced `envFrom` with explicit `env` entries:

```yaml
env:
  - name: DB_HOST
    valueFrom:
      configMapKeyRef: { name: backend-config, key: DB_HOST }
  - name: DB_PORT
    valueFrom:
      configMapKeyRef: { name: backend-config, key: DB_PORT }
  - name: DB_NAME
    valueFrom:
      configMapKeyRef: { name: backend-config, key: DB_NAME }
  - name: DB_USER
    valueFrom:
      secretKeyRef:   { name: backend-secret, key: DB_USER }
  - name: DB_PASSWORD
    valueFrom:
      secretKeyRef:   { name: backend-secret, key: DB_PASSWORD }
```

(My real file writes each one on separate lines; the `{ ... }` form above is just shorter.) `secretKeyRef` works exactly like `configMapKeyRef`, but reads from a Secret. PostgreSQL does the same: `POSTGRES_USER` / `POSTGRES_PASSWORD` come from `backend-secret` through `secretKeyRef`, and `POSTGRES_DB` from the ConfigMap.

### Notes

- Create the Secret **before** the Deployments that use it, or the Pod stays in `CreateContainerConfigError`.
- Like a ConfigMap, a changed Secret only reaches a Pod after `kubectl rollout restart`.
- `Backend-secret.yaml` holds the password in plain text, so it must **not** be pushed to a public repo as is. Use placeholders or create it with `kubectl create secret generic ... --from-literal=...`.

```bash
kubectl apply -f BackEnd/kubernetes/Backend-secret.yaml
kubectl get secret
kubectl describe secret backend-secret                      # shows key names and sizes, not values
kubectl get secret backend-secret -o jsonpath='{.data.DB_USER}' | base64 -d
```

---

## 6f. Namespace YAML file

### What a Namespace is

A **Namespace** is a named box inside the cluster that groups resources (Pods, Deployments, Services, ConfigMaps, Secrets). Everything I created so far lives in the `default` namespace. Namespaces let me keep projects or environments (dev / test) apart, use the same names in each, and apply limits per namespace.

### My Namespace (`BackEnd/kubernetes/namespace/Backend-namespace.yaml`)

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: backend-copy-namespace
```

To put something in it, add `namespace:` to its `metadata`. My copy of the backend Deployment (`namespace/Backend-deploymentcopy.yaml`) does this:

```yaml
metadata:
  name: backend-deployment
  namespace: backend-copy-namespace
```

### What I learned from testing it

`backend-deployment` in `backend-copy-namespace` stayed at `0/1` with `CreateContainerConfigError`. The reason: **ConfigMaps and Secrets are namespaced too**. A Pod can only use a ConfigMap / Secret from **its own namespace**, and `backend-config` / `backend-secret` exist only in `default`. The fix is to create them in the new namespace as well:

```bash
kubectl apply -f BackEnd/kubernetes/Backend-config.yaml -n backend-copy-namespace
kubectl apply -f BackEnd/kubernetes/Backend-secret.yaml -n backend-copy-namespace
```

Services need care too: `DB_HOST: pgsql-service` only resolves within the same namespace. From another namespace the full name is `pgsql-service.default.svc.cluster.local`.

### Commands

```bash
kubectl apply -f BackEnd/kubernetes/namespace/Backend-namespace.yaml
kubectl get namespaces
kubectl get all -n backend-copy-namespace     # -n selects the namespace
kubectl get pods -A                           # all namespaces
kubectl delete namespace backend-copy-namespace   # deletes EVERYTHING inside it
```

---

## 6g. PersistentVolume and PersistentVolumeClaim

### Why I need them

Every time the PostgreSQL Pod was recreated (for example after editing `Pgsql-deployment.yaml`), the `products` table and its rows disappeared and I had to run the migration and seed again. A container's filesystem is thrown away with the container. To keep the database files, they must live on storage that outlives the Pod.

- **PersistentVolume (PV):** a piece of storage in the cluster. It is cluster-wide (not namespaced).
- **PersistentVolumeClaim (PVC):** a Pod's request for storage ("I need 300Mi, read-write"). Kubernetes matches the claim to a suitable PV.
- The Pod never mentions the PV. It only names the **PVC**.

### My PersistentVolume (`BackEnd/kubernetes/pv.yaml`)

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: backend-pv
spec:
  storageClassName: pgsql-storage
  capacity:
    storage: 300Mi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  hostPath:
    path: /mnt/data/postgres
```

| Field | Meaning |
|-------|---------|
| `storageClassName` | A label used to match PV and PVC. Here it is a name I chose, `pgsql-storage`, not a real provisioner. |
| `capacity.storage` | Size of the volume. |
| `accessModes: ReadWriteOnce` | One node can mount it read-write. |
| `persistentVolumeReclaimPolicy: Retain` | When the PVC is deleted, keep the data (instead of `Delete`). |
| `hostPath.path` | The folder **on the Minikube node** that holds the files. Fine for learning on one node, not for real clusters. |

### My PersistentVolumeClaim (`BackEnd/kubernetes/pvc.yaml`)

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: backend-pvc
spec:
  storageClassName: pgsql-storage
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 300Mi
```

The claim binds to the PV because the `storageClassName` and `accessModes` match and the PV is big enough (300Mi >= 300Mi).

### Using it in the PostgreSQL Deployment

Added to `Pgsql-deployment.yaml`:

```yaml
          volumeMounts:
            - name: backend-pv-storage
              mountPath: /var/lib/postgresql/data
      volumes:
        - name: backend-pv-storage
          persistentVolumeClaim:
            claimName: backend-pvc
```

- `volumes` (Pod level) says "this Pod uses the claim `backend-pvc`, call it `backend-pv-storage`".
- `volumeMounts` (container level) mounts it at `/var/lib/postgresql/data`, the folder where the `postgres` image keeps its database files.

### Commands

```bash
kubectl apply -f BackEnd/kubernetes/pv.yaml
kubectl apply -f BackEnd/kubernetes/pvc.yaml
kubectl apply -f BackEnd/kubernetes/Pgsql-deployment.yaml
kubectl get pv,pvc          # both should show STATUS Bound
```

Current state on my cluster: `backend-pv` is `Bound` to `default/backend-pvc`.

### Things to watch

- **Apply order:** PV and PVC first, then the Deployment. Otherwise the Pod stays `Pending`.
- **Data is only kept from now on.** The first time the volume is mounted it is empty, so the migration and seed must be run once more ([section 9](#setting-up-the-tables)).
- **Not yet confirmed by a test:** I still need to delete the PostgreSQL Pod (`kubectl delete pod -l app=pgsql`) and check that the `products` rows survive.
- `hostPath` data lives inside the Minikube node. `minikube delete` removes it.
- With `Retain`, deleting the PVC leaves the PV in `Released` state; it must be cleaned up by hand before it can be claimed again.

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

Inside a container, files live in a writable layer that belongs to *that* container. When the Pod is deleted and re-created, the PostgreSQL container starts from the clean image again: **empty data, tables gone**, and `POSTGRES_*` variables initialize it from scratch. Without persistent storage anything I insert is temporary, which is what happened to me several times. I have since added a PersistentVolume and PersistentVolumeClaim and mounted them in the PostgreSQL Deployment ([6g](#6g-persistentvolume-and-persistentvolumeclaim)); the restart test is still to do.

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
- Writing Deployment YAML (`replicas`, `selector`, `template`), and how a Deployment recreates Pods and manages replicas.
- Writing Service YAML (`selector`, `port`, `targetPort`, `type`), the Service types, DNS names, and testing with `port-forward`.
- Running PostgreSQL as a second container in the backend Pod so the backend can use `127.0.0.1`, and loading data with `kubectl exec -c pgsql-container`.
- Managing Pods with `kubectl apply`, `get`, `describe`, `logs`, `exec`, `delete`.
- Diagnosing `ErrImagePull` and `ImagePullBackOff`.
- Setting up a basic PostgreSQL database and pointing the backend at it.
- The basic Kubernetes architecture (control plane, worker node) and the flow of a `kubectl apply`.
- Why `localhost` doesn't reach other Pods, and why data disappears without persistent storage.
- Writing a ConfigMap and why: one place for settings instead of repeating `env:` in every file ([6d](#6d-configmap-yaml-file)).
- `envFrom` / `configMapRef` (copy all keys) vs `valueFrom` / `configMapKeyRef` (pick one key, rename it).
- Splitting PostgreSQL into its own Deployment + `pgsql-service`, and seeding it with `kubectl exec -i deploy/pgsql-deployment -- psql ... < file.sql`.
- Reading the `POSTGRES_PASSWORD` error: the Postgres image only understands `POSTGRES_*` variable names.
- A ConfigMap change needs `kubectl rollout restart` to reach running Pods.
- Writing a Secret (`stringData`, `secretKeyRef`) and splitting config: non-sensitive values in the ConfigMap, user/password in the Secret ([6e](#6e-secret-yaml-file)). Base64 is not encryption.
- Creating a Namespace and putting resources in it with `metadata.namespace` ([6f](#6f-namespace-yaml-file)); ConfigMaps and Secrets must be in the same namespace as the Pod that uses them.
- Writing a PersistentVolume and PersistentVolumeClaim, matching them with `storageClassName`, and mounting the claim with `volumes` + `volumeMounts` ([6g](#6g-persistentvolume-and-persistentvolumeclaim)).

## 12. What I plan to learn next

These are **not done yet**; they are my to-do list.

- [x] **Services**: stable names/addresses (`ClusterIP` done, see [6c](#6c-service-yaml-files)).
- [ ] **NodePort / LoadBalancer Services**. (A separate PostgreSQL Deployment with `pgsql-service` is done.)
- [x] **Deployments**: self-healing Pods, replicas, rolling updates (basics done, see [6b](#6b-deployment-yaml-files-pod--deployment)).
- [x] **ConfigMaps**: move settings out of the Pod YAML (done, see [6d](#6d-configmap-yaml-file)).
- [x] **Secrets**: `DB_USER` / `DB_PASSWORD` moved out of the ConfigMap (done, see [6e](#6e-secret-yaml-file)). Still to do: don't commit real passwords.
- [x] **Namespaces**: created one and learned that ConfigMaps/Secrets are per-namespace (basics done, see [6f](#6f-namespace-yaml-file)).
- [x] **Persistent storage** (PersistentVolume / PersistentVolumeClaim): created and mounted, PV is `Bound` (see [6g](#6g-persistentvolume-and-persistentvolumeclaim)). Still to do: delete the PostgreSQL Pod and confirm the data survives.
- [ ] **Ingress**: route outside traffic to the frontend and backend.
- [ ] Add a `.dockerignore`, and production-style images (no dev server).
- [ ] Health checks (liveness / readiness probes) using the backend's `/health` endpoint.
- [ ] Fix the env variable name mismatch between `db.js`, `migrate.js` and the Pod YAML.

---

*This README is a living journal. Add new sections as I learn.*
