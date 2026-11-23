use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::debt_simplifier::DebtSimplifier;
use crate::models::{
    AppSettings, Expense, ExpenseCategory, PaymentSource, Person, Relationship,
    Settlement, SplitParticipant, SplitType, UserProfile,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ledger {
    pub version: u32,
    pub user_profile: UserProfile,
    pub settings: AppSettings,
    pub people: Vec<Person>,
    pub expenses: Vec<Expense>,
    pub settlements: Vec<Settlement>,
}

impl Default for Ledger {
    fn default() -> Self {
        Self {
            version: 1,
            user_profile: UserProfile::default(),
            settings: AppSettings::default(),
            people: Vec::new(),
            expenses: Vec::new(),
            settlements: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonSummary {
    pub person: Person,
    pub net_balance: f64, // positive = they owe you, negative = you owe them
    pub total_spent_on_them: f64,
    pub total_settled_by_them: f64,
    pub recent_expenses: Vec<Expense>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverallSummary {
    pub total_owed_to_me: f64,
    pub total_i_owe: f64,
    pub total_expenses_recorded: f64,
    pub total_people_count: usize,
    pub active_debtor_count: usize,
}

pub struct StorageManager {
    file_path: PathBuf,
    pub ledger: Ledger,
}

impl StorageManager {
    pub fn new<P: AsRef<Path>>(path: P) -> Self {
        let file_path = path.as_ref().to_path_buf();
        let ledger = Self::load_or_default(&file_path);
        Self { file_path, ledger }
    }

    fn load_or_default(path: &Path) -> Ledger {
        if path.exists() {
            if let Ok(content) = fs::read_to_string(path) {
                if let Ok(ledger) = serde_json::from_str::<Ledger>(&content) {
                    return ledger;
                }
            }
        }
        Ledger::default()
    }

    pub fn save(&self) -> Result<(), String> {
        if let Some(parent) = self.file_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let json = serde_json::to_string_pretty(&self.ledger).map_err(|e| e.to_string())?;
        let temp_path = self.file_path.with_extension("tmp");

        {
            let mut file = File::create(&temp_path).map_err(|e| e.to_string())?;
            file.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
            file.flush().map_err(|e| e.to_string())?;
        }

        fs::rename(&temp_path, &self.file_path).map_err(|e| e.to_string())?;
        Ok(())
    }

    // --- People Management ---
    pub fn add_person(
        &mut self,
        name: &str,
        relationship: Relationship,
        upi_id: Option<String>,
        phone: Option<String>,
    ) -> Result<Person, String> {
        let clean_name = name.trim();
        if clean_name.is_empty() {
            return Err("Person name cannot be empty".to_string());
        }

        let person = Person {
            id: Uuid::new_v4().to_string(),
            name: clean_name.to_string(),
            relationship,
            upi_id,
            phone,
            created_at: Utc::now(),
        };

        self.ledger.people.push(person.clone());
        self.save()?;
        Ok(person)
    }

    pub fn get_person(&self, id: &str) -> Option<&Person> {
        self.ledger.people.iter().find(|p| p.id == id)
    }

    pub fn delete_person(&mut self, id: &str) -> Result<(), String> {
        self.ledger.people.retain(|p| p.id != id);
        // Also clean up splits or keep expense history
        self.save()?;
        Ok(())
    }

    // --- Expense Management ---
    pub fn add_expense(
        &mut self,
        title: &str,
        total_amount: f64,
        split_type: SplitType,
        splits: Vec<SplitParticipant>,
        category: ExpenseCategory,
        payment_source: PaymentSource,
        notes: Option<String>,
        paytm_reference: Option<String>,
    ) -> Result<Expense, String> {
        if total_amount <= 0.0 {
            return Err("Amount must be greater than zero".to_string());
        }
        if splits.is_empty() {
            return Err("At least one person must be assigned to the expense".to_string());
        }

        let expense = Expense {
            id: Uuid::new_v4().to_string(),
            title: if title.trim().is_empty() { "Expense".to_string() } else { title.trim().to_string() },
            total_amount,
            paid_by_id: "me".to_string(),
            split_type,
            splits,
            category,
            payment_source,
            date: Utc::now(),
            notes,
            paytm_reference,
        };

        self.ledger.expenses.push(expense.clone());
        self.save()?;
        Ok(expense)
    }

    /// Quick logging helper for purchasing stuff entirely for one person (roommate/classmate/friend)
    pub fn snap_purchase_for_person(
        &mut self,
        person_id: &str,
        amount: f64,
        title: &str,
        category: ExpenseCategory,
        paytm_ref: Option<String>,
    ) -> Result<Expense, String> {
        if self.get_person(person_id).is_none() {
            return Err(format!("Person with ID '{}' not found", person_id));
        }

        self.add_expense(
            title,
            amount,
            SplitType::BoughtForPerson,
            vec![SplitParticipant {
                person_id: person_id.to_string(),
                amount_owed: amount,
            }],
            category,
            PaymentSource::Paytm,
            None,
            paytm_ref,
        )
    }

    pub fn delete_expense(&mut self, id: &str) -> Result<(), String> {
        self.ledger.expenses.retain(|e| e.id != id);
        self.save()?;
        Ok(())
    }

    // --- Settlements ---
    pub fn record_settlement(
        &mut self,
        person_id: &str,
        amount: f64,
        notes: Option<String>,
        payment_source: PaymentSource,
    ) -> Result<Settlement, String> {
        if amount <= 0.0 {
            return Err("Settlement amount must be greater than zero".to_string());
        }

        let settlement = Settlement {
            id: Uuid::new_v4().to_string(),
            from_person_id: person_id.to_string(),
            to_person_id: "me".to_string(),
            amount,
            date: Utc::now(),
            payment_source,
            notes,
        };

        self.ledger.settlements.push(settlement.clone());
        self.save()?;
        Ok(settlement)
    }

    // --- Balances & Summaries ---
    pub fn get_net_balances(&self) -> HashMap<String, f64> {
        DebtSimplifier::calculate_net_balances(&self.ledger.expenses, &self.ledger.settlements)
    }

    pub fn get_overall_summary(&self) -> OverallSummary {
        let balances = self.get_net_balances();
        let mut total_owed_to_me = 0.0;
        let mut total_i_owe = 0.0;
        let mut active_debtor_count = 0;

        for &val in balances.values() {
            if val > 0.01 {
                total_owed_to_me += val;
                active_debtor_count += 1;
            } else if val < -0.01 {
                total_i_owe += val.abs();
            }
        }

        let total_expenses: f64 = self.ledger.expenses.iter().map(|e| e.total_amount).sum();

        OverallSummary {
            total_owed_to_me: (total_owed_to_me * 100.0).round() / 100.0,
            total_i_owe: (total_i_owe * 100.0).round() / 100.0,
            total_expenses_recorded: (total_expenses * 100.0).round() / 100.0,
            total_people_count: self.ledger.people.len(),
            active_debtor_count,
        }
    }

    pub fn get_person_summary(&self, person_id: &str) -> Option<PersonSummary> {
        let person = self.get_person(person_id)?.clone();
        let balances = self.get_net_balances();
        let net_balance = *balances.get(person_id).unwrap_or(&0.0);

        let mut total_spent_on_them = 0.0;
        let mut recent_expenses = Vec::new();

        for exp in &self.ledger.expenses {
            for split in &exp.splits {
                if split.person_id == person_id {
                    total_spent_on_them += split.amount_owed;
                    recent_expenses.push(exp.clone());
                    break;
                }
            }
        }

        let mut total_settled_by_them = 0.0;
        for s in &self.ledger.settlements {
            if s.from_person_id == person_id && s.to_person_id == "me" {
                total_settled_by_them += s.amount;
            }
        }

        Some(PersonSummary {
            person,
            net_balance,
            total_spent_on_them: (total_spent_on_them * 100.0).round() / 100.0,
            total_settled_by_them: (total_settled_by_them * 100.0).round() / 100.0,
            recent_expenses,
        })
    }

    pub fn export_backup_json(&self) -> Result<String, String> {
        serde_json::to_string_pretty(&self.ledger).map_err(|e| e.to_string())
    }

    pub fn import_backup_json(&mut self, json_str: &str) -> Result<(), String> {
        let imported = serde_json::from_str::<Ledger>(json_str).map_err(|e| e.to_string())?;
        self.ledger = imported;
        self.save()?;
        Ok(())
    }
}
