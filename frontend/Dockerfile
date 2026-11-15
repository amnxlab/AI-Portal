# Serves the compiled SPA.
#
# `build/` is produced by `npm run build` (`tsc -b && vite build`) BEFORE this
# image is built, not inside it. Building in the image was tried and reverted:
# this server's route to the npm registry resets connections partway through a
# cold `npm ci`, which fails the image build. Running the install on the host
# instead lets it be retried against a warm cache until it completes, which is
# what the deploy notes describe.
#
# The server has no Node toolchain of its own, so the build runs in a throwaway
# container over the source tree:
#
#   cd /opt/aiserver/frontend
#   docker run --rm -v /opt/aiserver/frontend:/app -w /app -e HOME=/tmp \
#     --user "$(id -u):$(id -g)" node:20-alpine \
#     sh -c './node_modules/.bin/tsc -b && ./node_modules/.bin/vite build'
#
# `tsc -b` first is deliberate: it is what stops a type error reaching the
# bundle, since `vite build` alone does not typecheck.
#
# Vite writes to `build/`, not `dist/`: `dist/html` is an orphaned directory
# left by an April container operation whose ACLs deny removal, and Vite
# empties its outDir before writing, so it could never finish there.
FROM nginx:alpine
COPY build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
