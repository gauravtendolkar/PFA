-- Seed categories (Plaid personal_finance_category aligned)
-- Expense top-level
INSERT OR IGNORE INTO categories (id, slug, name, parent_id, classification, color, sort_order) VALUES
  ('cat_food',    'food_and_drink',    'Food & Drink',    NULL, 'expense', '#ef4444', 1),
  ('cat_housing', 'housing',           'Housing',         NULL, 'expense', '#3b82f6', 2),
  ('cat_transport','transportation',   'Transportation',  NULL, 'expense', '#8b5cf6', 3),
  ('cat_shopping','shopping',          'Shopping',        NULL, 'expense', '#f59e0b', 4),
  ('cat_entertain','entertainment',    'Entertainment',   NULL, 'expense', '#ec4899', 5),
  ('cat_health',  'health',            'Health & Wellness',NULL,'expense', '#10b981', 6),
  ('cat_personal','personal',          'Personal',        NULL, 'expense', '#6366f1', 7),
  ('cat_fees',    'fees',              'Fees & Charges',  NULL, 'expense', '#64748b', 8),
  ('cat_other_exp','other_expense',    'Other',           NULL, 'expense', '#94a3b8', 9);

-- Expense subcategories
INSERT OR IGNORE INTO categories (id, slug, name, parent_id, classification, sort_order) VALUES
  ('cat_food_rest',   'food_and_drink.restaurant', 'Restaurants',    'cat_food',    'expense', 1),
  ('cat_food_groc',   'food_and_drink.groceries',  'Groceries',      'cat_food',    'expense', 2),
  ('cat_food_deliv',  'food_and_drink.delivery',   'Delivery',       'cat_food',    'expense', 3),
  ('cat_food_coffee', 'food_and_drink.coffee',     'Coffee Shops',   'cat_food',    'expense', 4),
  ('cat_hous_rent',   'housing.rent',              'Rent',           'cat_housing', 'expense', 1),
  ('cat_hous_mort',   'housing.mortgage',          'Mortgage',       'cat_housing', 'expense', 2),
  ('cat_hous_util',   'housing.utilities',         'Utilities',      'cat_housing', 'expense', 3),
  ('cat_hous_maint',  'housing.maintenance',       'Maintenance',    'cat_housing', 'expense', 4),
  ('cat_trans_gas',   'transportation.gas',        'Gas',            'cat_transport','expense', 1),
  ('cat_trans_park',  'transportation.parking',    'Parking',        'cat_transport','expense', 2),
  ('cat_trans_ride',  'transportation.rideshare',  'Rideshare',      'cat_transport','expense', 3),
  ('cat_trans_pub',   'transportation.public',     'Public Transit', 'cat_transport','expense', 4),
  ('cat_shop_cloth',  'shopping.clothing',         'Clothing',       'cat_shopping', 'expense', 1),
  ('cat_shop_elec',   'shopping.electronics',      'Electronics',    'cat_shopping', 'expense', 2),
  ('cat_shop_gen',    'shopping.general',          'General',        'cat_shopping', 'expense', 3),
  ('cat_ent_stream',  'entertainment.streaming',   'Streaming',      'cat_entertain','expense', 1),
  ('cat_ent_events',  'entertainment.events',      'Events & Tickets','cat_entertain','expense',2),
  ('cat_ent_games',   'entertainment.games',       'Games',          'cat_entertain','expense', 3),
  ('cat_health_med',  'health.medical',            'Medical',        'cat_health',  'expense', 1),
  ('cat_health_fit',  'health.fitness',            'Fitness',        'cat_health',  'expense', 2),
  ('cat_health_pharm','health.pharmacy',           'Pharmacy',       'cat_health',  'expense', 3),
  ('cat_pers_subs',   'personal.subscriptions',    'Subscriptions',  'cat_personal','expense', 1),
  ('cat_pers_edu',    'personal.education',        'Education',      'cat_personal','expense', 2),
  ('cat_pers_travel', 'personal.travel',           'Travel',         'cat_personal','expense', 3),
  ('cat_fees_bank',   'fees.bank',                 'Bank Fees',      'cat_fees',    'expense', 1),
  ('cat_fees_int',    'fees.interest',             'Interest Charges','cat_fees',    'expense', 2),
  ('cat_fees_atm',    'fees.atm',                  'ATM Fees',       'cat_fees',    'expense', 3);

-- Income top-level
INSERT OR IGNORE INTO categories (id, slug, name, parent_id, classification, color, sort_order) VALUES
  ('cat_income',  'income',            'Income',          NULL, 'income', '#22c55e', 10);

-- Income subcategories
INSERT OR IGNORE INTO categories (id, slug, name, parent_id, classification, sort_order) VALUES
  ('cat_inc_salary', 'income.salary',     'Salary & Wages',     'cat_income', 'income', 1),
  ('cat_inc_free',   'income.freelance',  'Freelance & Contract','cat_income', 'income', 2),
  ('cat_inc_invest', 'income.investment', 'Investment Income',   'cat_income', 'income', 3),
  ('cat_inc_refund', 'income.refund',     'Refunds',             'cat_income', 'income', 4),
  ('cat_inc_other',  'income.other',      'Other Income',        'cat_income', 'income', 5);
