package server

import (
	"crypto/ecdsa"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"net/http"
)

// handleKeys 는 자기 기관 PKI의 공개 정보를 노출한다 (GET /v1/keys).
// 공개키·인증서만 반환한다 — 개인키는 키스토어(softhsm/KCMVP) 밖으로
// 절대 나오지 않으며, 응답에는 "보관 위치" 문자열만 담는다.
func (s *Server) handleKeys(w http.ResponseWriter, r *http.Request) {
	resp := map[string]interface{}{
		"orgId": s.cfg.IssuerOrg,
	}
	if s.cfg.CACert != nil {
		ca := certJSON(s.cfg.CACert, "기관 서명 CA (Org Root CA)")
		ca["privateKeyLocation"] = "오프라인 보관 — 수동 운영, 10년"
		resp["ca"] = ca
	}
	if cert, err := x509.ParseCertificate(s.cfg.LabelSigner.CertDER()); err == nil {
		info := certJSON(cert, "라벨 서명 (Label Signer)")
		info["privateKeyLocation"] = "서버 키스토어(softhsm/KCMVP) — 반출 불가, 90일 자동 교체"
		resp["labelSigner"] = info
	}
	if cert, err := x509.ParseCertificate(s.cfg.CheckpointSigner.CertDER()); err == nil {
		info := certJSON(cert, "원장 봉인 전용 (Checkpoint Signer)")
		info["privateKeyLocation"] = "서버 키스토어(softhsm/KCMVP) — 반출 불가, 1년"
		resp["checkpointSigner"] = info
	}
	revoked := []string{}
	for sn := range s.allRevokedSerials() {
		revoked = append(revoked, sn)
	}
	resp["revokedCertSerials"] = revoked

	// 발급기관 선택을 위한 전체 발급자 목록 (기본 + 추가 기관)
	issuers := []map[string]interface{}{}
	for id, iss := range s.allIssuers() {
		entry := map[string]interface{}{"orgId": id, "orgName": iss.OrgName}
		if cert, err := x509.ParseCertificate(iss.LabelSigner.CertDER()); err == nil {
			li := certJSON(cert, "라벨 서명 (Label Signer)")
			li["privateKeyLocation"] = "서버 키스토어(softhsm/KCMVP) — 반출 불가, 90일 자동 교체"
			entry["labelSigner"] = li
		}
		if iss.CACert != nil {
			ca := certJSON(iss.CACert, "기관 서명 CA (Org Root CA)")
			ca["privateKeyLocation"] = "오프라인 보관 — 수동 운영, 10년"
			entry["ca"] = ca
		}
		issuers = append(issuers, entry)
	}
	resp["issuers"] = issuers // 발급기관 선택용

	writeJSON(w, http.StatusOK, resp)
}

func certJSON(cert *x509.Certificate, role string) map[string]interface{} {
	out := map[string]interface{}{
		"role":      role,
		"subject":   cert.Subject.CommonName,
		"serial":    cert.SerialNumber.String(),
		"notBefore": cert.NotBefore,
		"notAfter":  cert.NotAfter,
		"sigAlg":    cert.SignatureAlgorithm.String(),
		"certPem":   string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: cert.Raw})),
	}
	if pub, ok := cert.PublicKey.(*ecdsa.PublicKey); ok {
		if e, err := pub.ECDH(); err == nil {
			out["publicKey"] = hex.EncodeToString(e.Bytes()) // 04‖X‖Y 비압축 좌표
			out["algorithm"] = "ECDSA P-256"
		}
	}
	return out
}
