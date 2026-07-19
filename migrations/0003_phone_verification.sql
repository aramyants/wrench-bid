ALTER TABLE shops
  ADD COLUMN phone_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN phone_verified_at timestamptz,
  ADD COLUMN phone_verification_method text;

ALTER TABLE shops
  ADD CONSTRAINT shops_phone_verification_method_check
    CHECK (
      phone_verification_method IS NULL
      OR phone_verification_method = 'user_attestation'
    ),
  ADD CONSTRAINT shops_phone_verification_consistency_check
    CHECK (
      (
        phone_verified = false
        AND phone_verified_at IS NULL
        AND phone_verification_method IS NULL
      )
      OR (
        phone_verified = true
        AND phone IS NOT NULL
        AND phone ~ '^\+[1-9][0-9]{7,14}$'
        AND phone_verified_at IS NOT NULL
        AND phone_verification_method = 'user_attestation'
      )
    );
