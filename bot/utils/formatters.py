def format_price(amount: int) -> str:
    """Format amount to UZS format: 25000 -> 25 000 so'm"""
    if amount is None:
        return "0 so'm"
    return f"{amount:,} so'm".replace(",", " ")

def format_order_summary(order: dict, lang: str = "uz") -> str:
    from bot.locales.i18n import locales
    i18n = locales.get(lang, locales["uz"])
    
    text = f"📦 Buyurtma {order['id']}\n\n"
    for item in order['items']:
        text += f"▪️ {item['qty']}x {item['name']} - {format_price(item['price'] * item['qty'])}\n"
    
    text += f"\nSubtotal: {format_price(order['subtotal'])}\n"
    if order.get('discount'):
        text += f"Chegirma: -{format_price(order['discount'])}\n"
    if order.get('loyalty_points_used'):
        text += f"Ballar (chegirma): -{format_price(order['loyalty_points_used'])}\n"
    text += f"Yetkazib berish: {format_price(order['delivery_fee'])}\n"
    text += f"\n💰 JAMI: {format_price(order['total'])}\n"
    text += f"📍 Manzil: {order.get('delivery_address', '')}\n"
    if order.get('note'):
        text += f"📝 Izoh: {order['note']}\n"
        
    return text
