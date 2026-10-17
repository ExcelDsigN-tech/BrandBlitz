ALTER TABLE IF EXISTS challenge_questions
  ADD COLUMN IF NOT EXISTS question_type TEXT,
  ADD COLUMN IF NOT EXISTS prompt_type TEXT;

UPDATE challenge_questions
SET question_type = CASE
  WHEN question_type IN ('which_brand', 'which_tagline', 'which_product') THEN question_type
  WHEN question_type IN ('tagline_recognition') THEN 'which_tagline'
  WHEN question_type IN ('product_recognition') THEN 'which_product'
  ELSE 'which_brand'
END;

UPDATE challenge_questions
SET prompt_type = CASE
  WHEN prompt_type IN ('logo', 'productImage1', 'tagline') THEN prompt_type
  WHEN prompt_type = 'productImage1' THEN 'productImage1'
  WHEN prompt_type = 'logo' THEN 'logo'
  ELSE 'tagline'
END;

ALTER TABLE IF EXISTS challenge_questions
  ALTER COLUMN question_type SET NOT NULL,
  ALTER COLUMN prompt_type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'challenge_questions_question_type_check'
  ) THEN
    ALTER TABLE challenge_questions
      ADD CONSTRAINT challenge_questions_question_type_check
      CHECK (question_type IN ('which_brand', 'which_tagline', 'which_product'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'challenge_questions_prompt_type_check'
  ) THEN
    ALTER TABLE challenge_questions
      ADD CONSTRAINT challenge_questions_prompt_type_check
      CHECK (prompt_type IN ('logo', 'productImage1', 'tagline'));
  END IF;
END $$;
