"""Fictional certificates for the store screenshots (Example Trust Services and
the "Contoso Inspection CA" interceptor). Only certificates are written; no
private key is kept. Usage: python3 store/tools/make_store_certs.py
"""
import datetime as dt
import os

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

OUT = os.path.join(os.path.dirname(__file__), "certs")
os.makedirs(OUT, exist_ok=True)
NOW = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)


def name(o, cn, c="US"):
    return x509.Name([x509.NameAttribute(NameOID.COUNTRY_NAME, c), x509.NameAttribute(NameOID.ORGANIZATION_NAME, o), x509.NameAttribute(NameOID.COMMON_NAME, cn)])


def ca(subject, key, issuer_name, issuer_key, start, days, path_len):
    return (
        x509.CertificateBuilder().subject_name(subject).issuer_name(issuer_name).public_key(key.public_key())
        .serial_number(x509.random_serial_number()).not_valid_before(start).not_valid_after(start + dt.timedelta(days=days))
        .add_extension(x509.BasicConstraints(ca=True, path_length=path_len), critical=True)
        .add_extension(x509.KeyUsage(True, False, False, False, False, True, True, False, False), critical=True)
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
        .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(issuer_key.public_key()), critical=False)
        .sign(issuer_key, hashes.SHA384() if isinstance(issuer_key, ec.EllipticCurvePrivateKey) else hashes.SHA256())
    )


def save(fname, certs):
    with open(os.path.join(OUT, fname), "wb") as f:
        for c in certs:
            f.write(c.public_bytes(serialization.Encoding.PEM))


# Genuine chain: Example Root CA 2024 > Example TLS ECC CA 2026 > www.example.com
root_key = ec.generate_private_key(ec.SECP384R1())
root_name = name("Example Trust Services", "Example Root CA 2024")
root = ca(root_name, root_key, root_name, root_key, NOW - dt.timedelta(days=800), 9000, None)
int_key = ec.generate_private_key(ec.SECP384R1())
int_name = name("Example Trust Services", "Example TLS ECC CA 2026")
inter = ca(int_name, int_key, root_name, root_key, NOW - dt.timedelta(days=300), 1500, 0)
leaf_key = ec.generate_private_key(ec.SECP256R1())
leaf = (
    x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "www.example.com")]))
    .issuer_name(int_name).public_key(leaf_key.public_key()).serial_number(x509.random_serial_number())
    .not_valid_before(NOW - dt.timedelta(days=31)).not_valid_after(NOW + dt.timedelta(days=59))
    .add_extension(x509.SubjectAlternativeName([x509.DNSName("www.example.com"), x509.DNSName("example.com")]), critical=False)
    .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
    .add_extension(x509.KeyUsage(True, False, False, False, False, False, False, False, False), critical=True)
    .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
    .add_extension(x509.CertificatePolicies([x509.PolicyInformation(x509.ObjectIdentifier("2.23.140.1.2.1"), None)]), critical=False)
    .add_extension(x509.AuthorityInformationAccess([
        x509.AccessDescription(x509.AuthorityInformationAccessOID.OCSP, x509.UniformResourceIdentifier("http://ocsp.example.net")),
        x509.AccessDescription(x509.AuthorityInformationAccessOID.CA_ISSUERS, x509.UniformResourceIdentifier("http://cacerts.example.net/tls-ecc-2026.crt")),
    ]), critical=False)
    .add_extension(x509.CRLDistributionPoints([x509.DistributionPoint([x509.UniformResourceIdentifier("http://crl.example.net/tls-ecc-2026.crl")], None, None, None)]), critical=False)
    .add_extension(x509.SubjectKeyIdentifier.from_public_key(leaf_key.public_key()), critical=False)
    .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(int_key.public_key()), critical=False)
    .sign(int_key, hashes.SHA384())
)
save("genuine-chain.pem", [leaf, inter, root])

# Interception chain: Contoso Inspection CA > www.example.com (minted on the fly, as such products do)
mitm_root_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
mitm_root_name = name("Contoso Ltd", "Contoso Inspection CA")
mitm_root = ca(mitm_root_name, mitm_root_key, mitm_root_name, mitm_root_key, NOW - dt.timedelta(days=400), 3650, None)
mitm_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
mitm_leaf = (
    x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "www.example.com")]))
    .issuer_name(mitm_root_name).public_key(mitm_key.public_key()).serial_number(x509.random_serial_number())
    .not_valid_before(NOW - dt.timedelta(days=1)).not_valid_after(NOW + dt.timedelta(days=364))
    .add_extension(x509.SubjectAlternativeName([x509.DNSName("www.example.com"), x509.DNSName("example.com")]), critical=False)
    .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
    .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
    .sign(mitm_root_key, hashes.SHA256())
)
save("intercepted-chain.pem", [mitm_leaf, mitm_root])
print("certificates written to", OUT)
