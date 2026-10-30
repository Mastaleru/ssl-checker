Throwaway test PKI used only by the automated tests. Never trust these certificates.
Regenerate with: sh tests/tools/make_tls_fixtures.sh (the CA private keys are not kept).

- localhost.crt / .key               self-signed localhost, used by tests/notary.test.mjs
- site-chain.pem / site-leaf.key      "real site": SSL Checker Test Root > Test Issuing CA > www.example.com
- intercept-chain.pem / intercept-leaf.key
                                      "interceptor": Contoso Inspection CA > www.example.com
