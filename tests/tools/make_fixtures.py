"""Generates edge-case certificates for the X.509 parser tests.

Usage: python3 tests/tools/make_fixtures.py <output-dir>
"""
import datetime as dt
import ipaddress
import os
import subprocess
import sys

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, ed25519, padding, rsa
from cryptography.x509.name import _ASN1Type
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
NOW = dt.datetime(2026, 10, 1, tzinfo=dt.timezone.utc)


def save(name, cert):
    with open(os.path.join(OUT, name + ".pem"), "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))


def name(*attrs):
    return x509.Name([x509.NameAttribute(oid, value) for oid, value in attrs])


ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
ca_name = name((NameOID.COUNTRY_NAME, "RO"), (NameOID.ORGANIZATION_NAME, "Fixture CA"), (NameOID.COMMON_NAME, "Fixture Root"))
ca = (
    x509.CertificateBuilder()
    .subject_name(ca_name)
    .issuer_name(ca_name)
    .public_key(ca_key.public_key())
    .serial_number(1)
    .not_valid_before(NOW)
    .not_valid_after(NOW + dt.timedelta(days=3650))
    .add_extension(x509.BasicConstraints(ca=True, path_length=1), critical=True)
    .add_extension(x509.KeyUsage(False, False, False, False, False, True, True, False, False), critical=True)
    .add_extension(x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()), critical=False)
    .sign(ca_key, hashes.SHA256())
)
save("gen-root-rsa2048", ca)


def leaf(key, subject, sans=None, serial=None, not_after=None, extra=(), sign_hash=hashes.SHA256(), pss=False):
    b = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(ca_name)
        .public_key(key.public_key())
        .serial_number(serial or x509.random_serial_number())
        .not_valid_before(NOW)
        .not_valid_after(not_after or NOW + dt.timedelta(days=90))
        .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
    )
    if sans:
        b = b.add_extension(x509.SubjectAlternativeName(sans), critical=False)
    for ext, critical in extra:
        b = b.add_extension(ext, critical=critical)
    if pss:
        return b.sign(ca_key, hashes.SHA256(), rsa_padding=padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=32))
    return b.sign(ca_key, sign_hash)


# 1. RSA 4096, validity past 2050 (GeneralizedTime), 20-byte serial with the high bit set.
k = rsa.generate_private_key(public_exponent=65537, key_size=4096)
save("gen-rsa4096-2051", leaf(
    k, name((NameOID.COMMON_NAME, "long.example.test")),
    sans=[x509.DNSName("long.example.test")],
    serial=int("8f" + "11" * 19, 16) >> 1,
    not_after=dt.datetime(2051, 6, 30, 12, 0, 0, tzinfo=dt.timezone.utc),
))

# 2. ECDSA P-384 with every SAN type.
k = ec.generate_private_key(ec.SECP384R1())
save("gen-p384-sans", leaf(
    k, name((NameOID.COMMON_NAME, "multi.example.test"), (NameOID.ORGANIZATION_NAME, "Multi SAN SRL")),
    sans=[
        x509.DNSName("multi.example.test"),
        x509.DNSName("*.multi.example.test"),
        x509.IPAddress(ipaddress.ip_address("192.0.2.10")),
        x509.IPAddress(ipaddress.ip_address("2001:db8::1")),
        x509.IPAddress(ipaddress.ip_address("2001:db8:0:1:0:0:0:5")),
        x509.RFC822Name("admin@multi.example.test"),
        x509.UniformResourceIdentifier("https://multi.example.test/"),
        x509.DirectoryName(name((NameOID.COMMON_NAME, "Dir Name"), (NameOID.COUNTRY_NAME, "RO"))),
    ],
    extra=[
        (x509.KeyUsage(True, False, False, False, True, False, False, False, False), True),
        (x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH, ExtendedKeyUsageOID.CLIENT_AUTH]), False),
        (x509.CertificatePolicies([x509.PolicyInformation(x509.ObjectIdentifier("2.23.140.1.1"), None),
                                   x509.PolicyInformation(x509.ObjectIdentifier("1.3.6.1.4.1.99999.1"), ["https://cps.example.test"])]), False),
        (x509.AuthorityInformationAccess([
            x509.AccessDescription(x509.AuthorityInformationAccessOID.OCSP, x509.UniformResourceIdentifier("http://ocsp.example.test")),
            x509.AccessDescription(x509.AuthorityInformationAccessOID.CA_ISSUERS, x509.UniformResourceIdentifier("http://ca.example.test/ca.der")),
        ]), False),
        (x509.CRLDistributionPoints([x509.DistributionPoint([x509.UniformResourceIdentifier("http://crl.example.test/a.crl"),
                                                             x509.UniformResourceIdentifier("http://crl2.example.test/a.crl")], None, None, None)]), False),
        (x509.TLSFeature([x509.TLSFeatureType.status_request]), False),
        (x509.BasicConstraints(ca=False, path_length=None), True),
    ],
))

# 3. Ed25519 leaf with a UTF8 / BMPString subject containing Romanian diacritics and a multi-valued RDN.
k = ed25519.Ed25519PrivateKey.generate()
subject = x509.Name([
    x509.RelativeDistinguishedName([x509.NameAttribute(NameOID.COUNTRY_NAME, "RO")]),
    x509.RelativeDistinguishedName([x509.NameAttribute(NameOID.LOCALITY_NAME, "Iași")]),
    x509.RelativeDistinguishedName([x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Ștefan & Fiii, S.R.L.", _type=_ASN1Type.BMPString)]),
    x509.RelativeDistinguishedName([
        x509.NameAttribute(NameOID.COMMON_NAME, "ed.example.test"),
        x509.NameAttribute(NameOID.USER_ID, "u-42"),
    ]),
])
save("gen-ed25519-utf8", leaf(k, subject, sans=[x509.DNSName("ed.example.test")]))

# 4. P-256 leaf signed with RSA-PSS, with an unknown critical extension.
k = ec.generate_private_key(ec.SECP256R1())
save("gen-pss-unknown-ext", leaf(
    k, name((NameOID.COMMON_NAME, "pss.example.test")),
    sans=[x509.DNSName("pss.example.test")],
    extra=[(x509.UnrecognizedExtension(x509.ObjectIdentifier("1.3.6.1.4.1.99999.7"), b"\x05\x00"), True)],
    pss=True,
))

# 5. P-521 leaf signed with SHA-512, name constraints present.
k = ec.generate_private_key(ec.SECP521R1())
save("gen-p521-sha512", leaf(
    k, name((NameOID.COMMON_NAME, "p521.example.test")),
    sans=[x509.DNSName("p521.example.test")],
    sign_hash=hashes.SHA512(),
    extra=[(x509.NameConstraints(permitted_subtrees=[x509.DNSName("example.test")], excluded_subtrees=None), True)],
))

# 6. Legacy v1 certificate and SHA-1 signature via openssl (cryptography always emits v3).
key_path = os.path.join(OUT, "_v1.key")
subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key_path,
                "-out", os.path.join(OUT, "_v1-tmp.pem"), "-days", "30", "-subj", "/CN=v1.example.test",
                "-sha1"], check=True, capture_output=True)
subprocess.run(["openssl", "x509", "-in", os.path.join(OUT, "_v1-tmp.pem"), "-signkey", key_path,
                "-out", os.path.join(OUT, "openssl-v1-sha1.pem"), "-days", "30", "-sha1", "-clrext"],
               check=True, capture_output=True)
for f in ("_v1.key", "_v1-tmp.pem"):
    os.remove(os.path.join(OUT, f))
print("fixtures written to", OUT)
