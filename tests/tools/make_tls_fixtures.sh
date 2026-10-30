#!/usr/bin/env sh
# Regenerates the throwaway test PKI in tests/fixtures/tls (needs openssl).
# The CA private keys are deleted at the end: nothing here can issue new certificates.
set -eu
cd "$(dirname "$0")/../fixtures/tls"
rm -f -- *.pem *.crt *.key

gen_ca() {
  openssl req -x509 -newkey rsa:2048 -nodes -keyout "$1.key" -out "$1.crt" -days 36500 -subj "$2" \
    -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
}
gen_leaf() { # name issuer extfile serial
  openssl ecparam -name prime256v1 -genkey -noout -out "$1.key"
  openssl req -new -key "$1.key" -out "$1.csr" -subj "/CN=www.example.com" 2>/dev/null
  openssl x509 -req -in "$1.csr" -CA "$2.crt" -CAkey "$2.key" -set_serial "$4" -out "$1.crt" -days 36500 -extfile "$3" 2>/dev/null
}

# Self-signed certificate for the notary tests.
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout localhost.key -out localhost.crt \
  -days 36500 -subj "/O=SSL Checker tests/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1" 2>/dev/null

# "Real site": SSL Checker Test Root > SSL Checker Test Issuing CA > www.example.com
gen_ca site-root "/C=RO/O=SSL Checker Test PKI/CN=SSL Checker Test Root"
openssl req -newkey rsa:2048 -nodes -keyout site-int.key -out site-int.csr \
  -subj "/C=RO/O=SSL Checker Test PKI/CN=SSL Checker Test Issuing CA" 2>/dev/null
printf 'basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid\n' > ca.ext
openssl x509 -req -in site-int.csr -CA site-root.crt -CAkey site-root.key -set_serial 0x1001 -out site-int.crt -days 36500 -extfile ca.ext 2>/dev/null
cat > leaf.ext <<'EOF'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=serverAuth
subjectAltName=DNS:www.example.com,DNS:example.com,DNS:localhost,IP:127.0.0.1
authorityInfoAccess=OCSP;URI:http://ocsp.test.invalid,caIssuers;URI:http://ca.test.invalid/issuing.der
crlDistributionPoints=URI:http://crl.test.invalid/issuing.crl
certificatePolicies=2.23.140.1.2.1
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid
EOF
gen_leaf site-leaf site-int leaf.ext 0x2001
cat site-leaf.crt site-int.crt > site-chain.pem

# "Interceptor": Contoso Inspection CA > www.example.com (a fictional HTTPS inspection product)
gen_ca intercept-root "/C=US/O=Contoso Ltd/CN=Contoso Inspection CA"
printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:www.example.com,DNS:example.com,DNS:localhost,IP:127.0.0.1\n' > ileaf.ext
gen_leaf intercept-leaf intercept-root ileaf.ext 0x3001
cat intercept-leaf.crt intercept-root.crt > intercept-chain.pem

rm -f -- *.csr *.ext *.srl site-root.key site-int.key intercept-root.key
for f in site-leaf intercept-leaf; do
  printf '%s SPKI sha256: %s\n' "$f" "$(openssl x509 -in "$f.crt" -noout -pubkey | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl base64)"
done
