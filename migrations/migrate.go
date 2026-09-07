// Package migrations 는 스키마 마이그레이션을 내장하고 실행한다 (golang-migrate).
package migrations

import (
	"embed"
	"errors"
	"fmt"
	"strings"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	"github.com/golang-migrate/migrate/v4/source/iofs"
)

//go:embed *.sql
var files embed.FS

// Run 은 dbURL(postgres://...)에 미적용 마이그레이션을 적용한다.
func Run(dbURL string) error {
	src, err := iofs.New(files, ".")
	if err != nil {
		return fmt.Errorf("migrations: load embedded files: %w", err)
	}
	url := dbURL
	for _, p := range []string{"postgres://", "postgresql://"} {
		if strings.HasPrefix(url, p) {
			url = "pgx5://" + strings.TrimPrefix(url, p)
			break
		}
	}
	m, err := migrate.NewWithSourceInstance("iofs", src, url)
	if err != nil {
		return fmt.Errorf("migrations: init: %w", err)
	}
	defer m.Close()
	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("migrations: up: %w", err)
	}
	return nil
}
