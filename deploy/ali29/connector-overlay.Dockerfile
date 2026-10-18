ARG BASE_IMAGE
FROM ${BASE_IMAGE}
COPY apps-connector-dist /repo/apps/connector/dist
COPY packages/database /repo/packages/database
COPY packages/mdop /repo/packages/mdop
COPY packages/space-kernel /repo/packages/space-kernel
COPY packages/wasm-algorithms /repo/packages/wasm-algorithms
COPY industries/med /repo/industries/med
COPY industries/power /repo/industries/power
RUN chmod -R a+rX /repo/packages /repo/industries /repo/apps/connector/dist \
 && mkdir -p /repo/node_modules/@medtrust \
 && ln -sfn ../../packages/database /repo/node_modules/@medtrust/database \
 && ln -sfn ../../packages/mdop /repo/node_modules/@medtrust/mdop \
 && ln -sfn ../../packages/space-kernel /repo/node_modules/@medtrust/space-kernel \
 && ln -sfn ../../packages/wasm-algorithms /repo/node_modules/@medtrust/wasm-algorithms \
 && ln -sfn ../../industries/med /repo/node_modules/@medtrust/domain-med \
 && ln -sfn ../../industries/power /repo/node_modules/@medtrust/domain-power
