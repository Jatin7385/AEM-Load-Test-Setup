FROM ubuntu:22.04
RUN apt-get update && apt-get install -y \
    openjdk-11-jre-headless \
    curl net-tools \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /aem/tmp && chmod 777 /aem/tmp
WORKDIR /aem
COPY aem-publish-p4503.jar ./
COPY license.properties ./
RUN mkdir -p packages

# CQ_JVM_OPTS is used by AEM's quickstart when forking the child JVM
ENV CQ_JVM_OPTS="-Xms4g -Xmx8g -Djava.io.tmpdir=/aem/tmp -Dsling.http.port=4503 -Dsling.http.hostname=0.0.0.0 -Djava.awt.headless=true"

EXPOSE 4503
CMD ["sh", "-c", "chmod -R 777 /aem/crx-quickstart 2>/dev/null || true && chmod 777 /tmp && java -Xms4g -Xmx8g -Djava.io.tmpdir=/aem/tmp -Dsling.http.port=4503 -Dsling.http.hostname=0.0.0.0 -Djava.awt.headless=true -jar aem-publish-p4503.jar -r publish -p 4503 -nobrowser -nofork"]

