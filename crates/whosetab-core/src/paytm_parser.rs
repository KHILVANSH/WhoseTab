use regex::Regex;
use crate::models::ExpenseCategory;

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedPaytmTransaction {
    pub amount: f64,
    pub recipient: Option<String>,
    pub note: Option<String>,
    pub transaction_id: Option<String>,
    pub suggested_category: ExpenseCategory,
    pub raw_text: String,
}

pub struct PaytmParser;

impl PaytmParser {
    /// Parse raw SMS text, notification body, or shared receipt string
    pub fn parse_text(text: &str) -> Option<ParsedPaytmTransaction> {
        let clean = text.trim();
        if clean.is_empty() {
            return None;
        }

        // 1. Check for deep-link / URI query format first:
        // whosetab://snap?amount=350&to=Rohan&note=Groceries
        if clean.contains("amount=") {
            if let Some(parsed) = Self::parse_uri_query(clean) {
                return Some(parsed);
            }
        }

        // 2. Amount regex patterns:
        // ₹450, Rs. 450, Rs 450.50, INR 450, 450.00
        let amount_re = Regex::new(
            r"(?i)(?:paid|sent|transfer of|debited by|rs\.?|inr|₹)\s*(?:rs\.?|inr|₹)?\s*([0-9]+(?:,[0-9]+)*(?:\.[0-9]{1,2})?)"
        ).ok()?;

        let mut extracted_amount: Option<f64> = None;
        if let Some(caps) = amount_re.captures(clean) {
            if let Some(m) = caps.get(1) {
                let sanitized = m.as_str().replace(',', "");
                if let Ok(val) = sanitized.parse::<f64>() {
                    if val > 0.0 {
                        extracted_amount = Some(val);
                    }
                }
            }
        }

        let amount = extracted_amount?;

        // 3. Recipient extraction: "to <Recipient>", "at <Merchant>"
        let recipient_re = Regex::new(
            r"(?i)(?:to|at|for)\s+([A-Za-z0-9\s&'\.]+?)(?:\s+(?:successfully|via|on|ref|upi|txn|using|with|is successful|\.|$))"
        ).ok();

        let mut recipient: Option<String> = None;
        if let Some(ref re) = recipient_re {
            if let Some(caps) = re.captures(clean) {
                if let Some(m) = caps.get(1) {
                    let r = m.as_str().trim();
                    if !r.is_empty() && r.len() < 50 {
                        recipient = Some(r.to_string());
                    }
                }
            }
        }

        // 4. Transaction ID extraction
        let txn_re = Regex::new(r"(?i)(?:txn(?: id)?|ref(?: no)?|upi ref)[:\s]+([A-Za-z0-9]+)").ok();
        let txn_id = txn_re.and_then(|re| {
            re.captures(clean)
                .and_then(|c| c.get(1))
                .map(|m| m.as_str().to_string())
        });

        // 5. Category suggestion based on recipient & text
        let suggested_category = Self::infer_category(clean, recipient.as_deref());

        Some(ParsedPaytmTransaction {
            amount,
            recipient,
            note: None,
            transaction_id: txn_id,
            suggested_category,
            raw_text: clean.to_string(),
        })
    }

    /// Parse whosetab://snap?amount=250&to=Sharma&note=Milk
    fn parse_uri_query(uri: &str) -> Option<ParsedPaytmTransaction> {
        let query_part = if let Some(idx) = uri.find('?') {
            &uri[idx + 1..]
        } else {
            uri
        };

        let mut amount: Option<f64> = None;
        let mut recipient: Option<String> = None;
        let mut note: Option<String> = None;

        for pair in query_part.split('&') {
            let mut parts = pair.split('=');
            if let (Some(k), Some(v)) = (parts.next(), parts.next()) {
                let decoded = v.replace("%20", " ").replace('+', " ");
                match k.to_lowercase().as_str() {
                    "amount" | "amt" => {
                        amount = decoded.replace(',', "").parse::<f64>().ok();
                    }
                    "to" | "recipient" | "name" => {
                        recipient = Some(decoded);
                    }
                    "note" | "title" | "desc" => {
                        note = Some(decoded);
                    }
                    _ => {}
                }
            }
        }

        let amt = amount?;
        let cat = Self::infer_category(
            note.as_deref().unwrap_or(""),
            recipient.as_deref(),
        );

        Some(ParsedPaytmTransaction {
            amount: amt,
            recipient,
            note,
            transaction_id: None,
            suggested_category: cat,
            raw_text: uri.to_string(),
        })
    }

    pub fn infer_category(text: &str, recipient: Option<&str>) -> ExpenseCategory {
        let full = format!("{} {}", text, recipient.unwrap_or("")).to_lowercase();

        if full.contains("chai") || full.contains("tea") || full.contains("samosa") || full.contains("juice") {
            ExpenseCategory::SnacksChai
        } else if full.contains("kirana") || full.contains("grocer") || full.contains("mart") || full.contains("supermarket") || full.contains("vegetable") || full.contains("milk") {
            ExpenseCategory::Groceries
        } else if full.contains("canteen") || full.contains("cafe") || full.contains("food") || full.contains("dining") || full.contains("restaurant") || full.contains("swiggy") || full.contains("zomato") || full.contains("biryani") {
            ExpenseCategory::FoodDining
        } else if full.contains("xerox") || full.contains("print") || full.contains("stationery") || full.contains("book") || full.contains("lab") || full.contains("notes") {
            ExpenseCategory::StationeryBooks
        } else if full.contains("cab") || full.contains("auto") || full.contains("uber") || full.contains("ola") || full.contains("rapido") || full.contains("metro") {
            ExpenseCategory::TravelCab
        } else if full.contains("rent") || full.contains("wifi") || full.contains("broadband") || full.contains("electricity") || full.contains("maid") {
            ExpenseCategory::RoomRentUtilities
        } else if full.contains("medical") || full.contains("pharmacy") || full.contains("chemist") || full.contains("medicine") {
            ExpenseCategory::Medical
        } else {
            ExpenseCategory::General
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_standard_paytm_sms() {
        let sms = "Paid ₹340 to Sharma Groceries successfully via Paytm. Txn ID: PT192837482";
        let parsed = PaytmParser::parse_text(sms).expect("Should parse SMS");
        assert_eq!(parsed.amount, 340.0);
        assert_eq!(parsed.recipient.as_deref(), Some("Sharma Groceries"));
        assert_eq!(parsed.suggested_category, ExpenseCategory::Groceries);
        assert_eq!(parsed.transaction_id.as_deref(), Some("PT192837482"));
    }

    #[test]
    fn test_parse_canteen_upi() {
        let msg = "Sent Rs 85.00 to Campus Canteen on 23 Nov 2026. UPI Ref: 4829104820";
        let parsed = PaytmParser::parse_text(msg).expect("Should parse UPI");
        assert_eq!(parsed.amount, 85.0);
        assert_eq!(parsed.suggested_category, ExpenseCategory::FoodDining);
    }

    #[test]
    fn test_parse_uri() {
        let uri = "whosetab://snap?amount=450&to=Rohan&note=Lab%20Manual";
        let parsed = PaytmParser::parse_text(uri).expect("Should parse URI");
        assert_eq!(parsed.amount, 450.0);
        assert_eq!(parsed.recipient.as_deref(), Some("Rohan"));
        assert_eq!(parsed.note.as_deref(), Some("Lab Manual"));
        assert_eq!(parsed.suggested_category, ExpenseCategory::StationeryBooks);
    }
}
