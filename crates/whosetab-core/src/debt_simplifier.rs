use std::collections::HashMap;
use crate::models::{Expense, Settlement, SimplifiedTransaction};

pub struct DebtSimplifier;

impl DebtSimplifier {
    /// Calculate net balances for each person relative to the user ("me").
    /// Positive balance = this person owes "me" money.
    /// Negative balance = "me" owes this person money.
    pub fn calculate_net_balances(
        expenses: &[Expense],
        settlements: &[Settlement],
    ) -> HashMap<String, f64> {
        let mut balances: HashMap<String, f64> = HashMap::new();

        // 1. Process Expenses
        for exp in expenses {
            if exp.paid_by_id == "me" {
                // User paid, participants owe user
                for split in &exp.splits {
                    if split.person_id != "me" {
                        *balances.entry(split.person_id.clone()).or_insert(0.0) += split.amount_owed;
                    }
                }
            } else {
                // Someone else paid!
                let payer_id = &exp.paid_by_id;
                // If "me" is in the split, "me" owes the payer
                for split in &exp.splits {
                    if split.person_id == "me" {
                        *balances.entry(payer_id.clone()).or_insert(0.0) -= split.amount_owed;
                    }
                }
            }
        }

        // 2. Process Settlements
        for s in settlements {
            if s.to_person_id == "me" {
                // Person paid user -> decreases what they owe user
                *balances.entry(s.from_person_id.clone()).or_insert(0.0) -= s.amount;
            } else if s.from_person_id == "me" {
                // User paid person -> decreases what user owed that person
                *balances.entry(s.to_person_id.clone()).or_insert(0.0) += s.amount;
            }
        }

        // Round to 2 decimal places to prevent float rounding noise
        for val in balances.values_mut() {
            *val = (*val * 100.0).round() / 100.0;
        }

        balances
    }

    /// Simplify multi-party group debts into minimal cash flow transfers.
    pub fn simplify_group_debts(
        participants: &[(String, String)], // (id, name)
        expenses: &[Expense],
        settlements: &[Settlement],
    ) -> Vec<SimplifiedTransaction> {
        let mut name_map: HashMap<String, String> = HashMap::new();
        for (id, name) in participants {
            name_map.insert(id.clone(), name.clone());
        }

        // Compute global net balance for each person
        let mut net_flow: HashMap<String, f64> = HashMap::new();

        for exp in expenses {
            // Payer is credited the total amount
            *net_flow.entry(exp.paid_by_id.clone()).or_insert(0.0) += exp.total_amount;
            // Each participant is debited their split
            for split in &exp.splits {
                *net_flow.entry(split.person_id.clone()).or_insert(0.0) -= split.amount_owed;
            }
        }

        for s in settlements {
            *net_flow.entry(s.from_person_id.clone()).or_insert(0.0) += s.amount;
            *net_flow.entry(s.to_person_id.clone()).or_insert(0.0) -= s.amount;
        }

        // Separate debtors (negative balance) and creditors (positive balance)
        let mut debtors: Vec<(String, f64)> = Vec::new();
        let mut creditors: Vec<(String, f64)> = Vec::new();

        for (id, balance) in net_flow {
            let rounded = (balance * 100.0).round() / 100.0;
            if rounded < -0.01 {
                debtors.push((id, -rounded)); // Store as positive amount owed
            } else if rounded > 0.01 {
                creditors.push((id, rounded));
            }
        }

        // Sort descending
        debtors.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        creditors.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        let mut transactions = Vec::new();
        let mut d_idx = 0;
        let mut c_idx = 0;

        while d_idx < debtors.len() && c_idx < creditors.len() {
            let debtor = &mut debtors[d_idx];
            let creditor = &mut creditors[c_idx];

            let settled_amt = debtor.1.min(creditor.1);
            let settled_rounded = (settled_amt * 100.0).round() / 100.0;

            if settled_rounded > 0.01 {
                let from_id = debtor.0.clone();
                let to_id = creditor.0.clone();
                let from_name = name_map.get(&from_id).cloned().unwrap_or_else(|| from_id.clone());
                let to_name = name_map.get(&to_id).cloned().unwrap_or_else(|| to_id.clone());

                transactions.push(SimplifiedTransaction {
                    from_id,
                    from_name,
                    to_id,
                    to_name,
                    amount: settled_rounded,
                });
            }

            debtor.1 -= settled_amt;
            creditor.1 -= settled_amt;

            if debtor.1 < 0.01 {
                d_idx += 1;
            }
            if creditor.1 < 0.01 {
                c_idx += 1;
            }
        }

        transactions
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ExpenseCategory, PaymentSource, SplitParticipant, SplitType};
    use chrono::Utc;

    #[test]
    fn test_direct_purchase_net_balance() {
        let expense = Expense {
            id: "e1".to_string(),
            title: "Canteen Samosas".to_string(),
            total_amount: 100.0,
            paid_by_id: "me".to_string(),
            split_type: SplitType::BoughtForPerson,
            splits: vec![SplitParticipant {
                person_id: "friend1".to_string(),
                amount_owed: 100.0,
            }],
            category: ExpenseCategory::SnacksChai,
            payment_source: PaymentSource::Paytm,
            date: Utc::now(),
            notes: None,
            paytm_reference: None,
        };

        let balances = DebtSimplifier::calculate_net_balances(&[expense], &[]);
        assert_eq!(balances.get("friend1"), Some(&100.0));
    }

    #[test]
    fn test_settlement_clears_balance() {
        let expense = Expense {
            id: "e1".to_string(),
            title: "Groceries".to_string(),
            total_amount: 500.0,
            paid_by_id: "me".to_string(),
            split_type: SplitType::BoughtForPerson,
            splits: vec![SplitParticipant {
                person_id: "roommate1".to_string(),
                amount_owed: 500.0,
            }],
            category: ExpenseCategory::Groceries,
            payment_source: PaymentSource::Paytm,
            date: Utc::now(),
            notes: None,
            paytm_reference: None,
        };

        let settlement = Settlement {
            id: "s1".to_string(),
            from_person_id: "roommate1".to_string(),
            to_person_id: "me".to_string(),
            amount: 500.0,
            date: Utc::now(),
            payment_source: PaymentSource::UpiGeneric,
            notes: Some("Paid via UPI".to_string()),
        };

        let balances = DebtSimplifier::calculate_net_balances(&[expense], &[settlement]);
        assert_eq!(balances.get("roommate1"), Some(&0.0));
    }
}
