-- 5 categories: Burgerlar, Pizzalar, Sneklar, Ichimliklar, Kombolar
INSERT INTO categories (id, name_uz, name_ru, name_en, emoji, sort_order) VALUES
('11111111-1111-1111-1111-111111111111', 'Burgerlar', 'Бургеры', 'Burgers', '🍔', 1),
('22222222-2222-2222-2222-222222222222', 'Pizzalar', 'Пиццы', 'Pizzas', '🍕', 2),
('33333333-3333-3333-3333-333333333333', 'Sneklar', 'Снеки', 'Snacks', '🍟', 3),
('44444444-4444-4444-4444-444444444444', 'Ichimliklar', 'Напитки', 'Drinks', '🥤', 4),
('55555555-5555-5555-5555-555555555555', 'Kombolar', 'Комбо', 'Combos', '🍱', 5);

-- 3 sample menu items per category with all 3 language fields

-- Burgers
INSERT INTO menu_items (category_id, name_uz, name_ru, name_en, description_uz, description_ru, description_en, price, emoji, badge, sort_order) VALUES
('11111111-1111-1111-1111-111111111111', 'Klassik Burger', 'Классический Бургер', 'Classic Burger', 'Mol go''shti, pishloq, pomidor, maxsus sous', 'Говядина, сыр, помидор, фирменный соус', 'Beef patty, cheese, tomato, signature sauce', 25000, '🍔', '🔥 Hit', 1),
('11111111-1111-1111-1111-111111111111', 'Qo''shaloq Burger', 'Двойной Бургер', 'Double Burger', 'Ikki karra mol go''shti, pishloq', 'Двойная говядина, сыр', 'Double beef patty, cheese', 35000, '🍔', '', 2),
('11111111-1111-1111-1111-111111111111', 'Tovuqli Burger', 'Куриный Бургер', 'Chicken Burger', 'Qarsildoq tovuq filesi, aysberg, sous', 'Хрустящее куриное филе, айсберг, соус', 'Crispy chicken fillet, iceberg, sauce', 22000, '🍗', '', 3);

-- Pizzas
INSERT INTO menu_items (category_id, name_uz, name_ru, name_en, description_uz, description_ru, description_en, price, emoji, badge, sort_order) VALUES
('22222222-2222-2222-2222-222222222222', 'Margarita', 'Маргарита', 'Margherita', 'Mozzarella pishlog''i, tomat sousi', 'Сыр моцарелла, томатный соус', 'Mozzarella cheese, tomato sauce', 45000, '🍕', '', 1),
('22222222-2222-2222-2222-222222222222', 'Pepperoni', 'Пепперони', 'Pepperoni', 'Pepperoni kolbasasi, mozzarella', 'Колбаса пепперони, моцарелла', 'Pepperoni sausage, mozzarella', 55000, '🍕', '🔥 Hit', 2),
('22222222-2222-2222-2222-222222222222', 'Tovuqli Pizza', 'Куриная Пицца', 'Chicken Pizza', 'Tovuq go''shti, qo''ziqorin, pishloq', 'Курица, грибы, сыр', 'Chicken, mushrooms, cheese', 50000, '🍕', '⭐ New', 3);

-- Snacks
INSERT INTO menu_items (category_id, name_uz, name_ru, name_en, description_uz, description_ru, description_en, price, emoji, badge, sort_order) VALUES
('33333333-3333-3333-3333-333333333333', 'Kartoshka Fri', 'Картофель Фри', 'French Fries', 'Qarsildoq kartoshka', 'Хрустящий картофель', 'Crispy fries', 15000, '🍟', '', 1),
('33333333-3333-3333-3333-333333333333', 'Naggetslar', 'Наггетсы', 'Nuggets', 'Tovuq naggetslari (6 dona)', 'Куриные наггетсы (6 шт)', 'Chicken nuggets (6 pcs)', 18000, '🍗', '', 2),
('33333333-3333-3333-3333-333333333333', 'Pishloqli tayoqchalar', 'Сырные палочки', 'Cheese Sticks', 'Eruvchan pishloqli tayoqchalar', 'Палочки с плавленым сыром', 'Melted cheese sticks', 22000, '🧀', '', 3);

-- Drinks
INSERT INTO menu_items (category_id, name_uz, name_ru, name_en, description_uz, description_ru, description_en, price, emoji, badge, sort_order) VALUES
('44444444-4444-4444-4444-444444444444', 'Coca Cola 0.5L', 'Кока-Кола 0.5л', 'Coca Cola 0.5L', 'Muzdek kola', 'Холодная кола', 'Ice cold cola', 8000, '🥤', '', 1),
('44444444-4444-4444-4444-444444444444', 'Fanta 0.5L', 'Фанта 0.5л', 'Fanta 0.5L', 'Apelsinli fanta', 'Апельсиновая фанта', 'Orange fanta', 8000, '🥤', '', 2),
('44444444-4444-4444-4444-444444444444', 'Sprite 0.5L', 'Спрайт 0.5л', 'Sprite 0.5L', 'Limonli sprite', 'Лимонный спрайт', 'Lemon sprite', 8000, '🥤', '', 3);

-- Combos
INSERT INTO menu_items (category_id, name_uz, name_ru, name_en, description_uz, description_ru, description_en, price, emoji, badge, sort_order) VALUES
('55555555-5555-5555-5555-555555555555', 'Klassik Kombo', 'Классическое Комбо', 'Classic Combo', 'Burger, Fri, Kola', 'Бургер, Фри, Кола', 'Burger, Fries, Cola', 45000, '🍱', '', 1),
('55555555-5555-5555-5555-555555555555', 'Pizza Kombo', 'Пицца Комбо', 'Pizza Combo', 'Margarita, 2x Kola', 'Маргарита, 2х Кола', 'Margherita, 2x Cola', 58000, '🍱', '🔥 Hit', 2),
('55555555-5555-5555-5555-555555555555', 'Katta Kombo', 'Большое Комбо', 'Big Combo', '2x Burger, 2x Fri, 2x Kola', '2х Бургер, 2х Фри, 2х Кола', '2x Burger, 2x Fries, 2x Cola', 85000, '🍱', '', 3);
