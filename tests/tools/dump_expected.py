"""Dumps reference values for every *.pem in a directory, using pyca/cryptography.

Usage: python3 tests/tools/dump_expected.py <fixtures-dir> > expected.json
"""
import base64
import glob
import hashlib
import json
import os
import sys

from cryptography import x509
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, ed448, ed25519, rsa

CURVES = {"secp256r1": "P-256", "secp384r1": "P-384", "secp521r1": "P-521"}


def ext_value(cert, cls):
    try:
        return cert.extensions.get_extension_for_class(cls).value
    except x509.ExtensionNotFound:
        return None


def dump(cert):
    der = cert.public_bytes(serialization.Encoding.DER)
    spki = cert.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    pk = cert.public_key()
    if isinstance(pk, rsa.RSAPublicKey):
        key = {"algorithm": "RSA", "bits": pk.key_size, "curve": None}
    elif isinstance(pk, ec.EllipticCurvePublicKey):
        key = {"algorithm": "EC", "bits": pk.curve.key_size, "curve": CURVES.get(pk.curve.name, pk.curve.name)}
    elif isinstance(pk, ed25519.Ed25519PublicKey):
        key = {"algorithm": "Ed25519", "bits": 256, "curve": None}
    elif isinstance(pk, ed448.Ed448PublicKey):
        key = {"algorithm": "Ed448", "bits": 456, "curve": None}
    else:
        key = {"algorithm": type(pk).__name__, "bits": None, "curve": None}

    out = {
        "version": cert.version.value + 1,
        "serialNumber": format(cert.serial_number, "x"),
        "signatureOid": cert.signature_algorithm_oid.dotted_string,
        "notBefore": cert.not_valid_before_utc.isoformat().replace("+00:00", ".000Z"),
        "notAfter": cert.not_valid_after_utc.isoformat().replace("+00:00", ".000Z"),
        "subject": [[[a.oid.dotted_string, a.value] for a in rdn] for rdn in cert.subject.rdns],
        "issuer": [[[a.oid.dotted_string, a.value] for a in rdn] for rdn in cert.issuer.rdns],
        "publicKey": key,
        "sha256": hashlib.sha256(der).hexdigest(),
        "sha1": hashlib.sha1(der).hexdigest(),
        "spkiSha256": base64.b64encode(hashlib.sha256(spki).digest()).decode(),
        "extensions": [[e.oid.dotted_string, e.critical] for e in cert.extensions] if cert.version.value == 2 else [],
    }

    san = ext_value(cert, x509.SubjectAlternativeName)
    out["san"] = None if san is None else {
        "dns": san.get_values_for_type(x509.DNSName),
        "ip": [str(ip) for ip in san.get_values_for_type(x509.IPAddress)],
        "email": san.get_values_for_type(x509.RFC822Name),
        "uri": san.get_values_for_type(x509.UniformResourceIdentifier),
        "dirCount": len(san.get_values_for_type(x509.DirectoryName)),
    }
    bc = ext_value(cert, x509.BasicConstraints)
    out["basicConstraints"] = None if bc is None else {"ca": bc.ca, "pathLen": bc.path_length}
    ku = ext_value(cert, x509.KeyUsage)
    if ku is None:
        out["keyUsage"] = None
    else:
        names = ["digital_signature", "content_commitment", "key_encipherment", "data_encipherment", "key_agreement", "key_cert_sign", "crl_sign"]
        js = ["digitalSignature", "nonRepudiation", "keyEncipherment", "dataEncipherment", "keyAgreement", "keyCertSign", "cRLSign"]
        usages = [j for n, j in zip(names, js) if getattr(ku, n)]
        if ku.key_agreement:
            if ku.encipher_only:
                usages.append("encipherOnly")
            if ku.decipher_only:
                usages.append("decipherOnly")
        out["keyUsage"] = usages
    eku = ext_value(cert, x509.ExtendedKeyUsage)
    out["eku"] = None if eku is None else [o.dotted_string for o in eku]
    pol = ext_value(cert, x509.CertificatePolicies)
    out["policies"] = None if pol is None else [p.policy_identifier.dotted_string for p in pol]
    aia = ext_value(cert, x509.AuthorityInformationAccess)
    out["ocsp"] = [] if aia is None else [d.access_location.value for d in aia if d.access_method == x509.AuthorityInformationAccessOID.OCSP]
    out["caIssuers"] = [] if aia is None else [d.access_location.value for d in aia if d.access_method == x509.AuthorityInformationAccessOID.CA_ISSUERS]
    crl = ext_value(cert, x509.CRLDistributionPoints)
    out["crl"] = [] if crl is None else [n.value for dp in crl for n in (dp.full_name or []) if isinstance(n, x509.UniformResourceIdentifier)]
    ski = ext_value(cert, x509.SubjectKeyIdentifier)
    out["ski"] = None if ski is None else ski.digest.hex()
    aki = ext_value(cert, x509.AuthorityKeyIdentifier)
    out["aki"] = None if aki is None or aki.key_identifier is None else aki.key_identifier.hex()
    scts = ext_value(cert, x509.PrecertificateSignedCertificateTimestamps)
    out["scts"] = None if scts is None else [
        {"logId": base64.b64encode(s.log_id).decode(), "timestamp": s.timestamp.replace(tzinfo=None).isoformat(timespec="milliseconds") + "Z"} for s in scts
    ]
    tlsf = ext_value(cert, x509.TLSFeature)
    out["mustStaple"] = bool(tlsf and x509.TLSFeatureType.status_request in list(tlsf))
    return out


result = {}
for path in sorted(glob.glob(os.path.join(sys.argv[1], "*.pem"))):
    with open(path, "rb") as f:
        certs = x509.load_pem_x509_certificates(f.read())
    for i, cert in enumerate(certs):
        result[f"{os.path.basename(path)}#{i}"] = dump(cert)
json.dump(result, sys.stdout, indent=1, ensure_ascii=False)
