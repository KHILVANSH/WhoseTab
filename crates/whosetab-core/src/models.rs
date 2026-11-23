use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum Relationship {
    Roommate,
    Classmate,
    Friend,
    Other,
}

impl Default for Relationship {
    fn default() -> Self {
        Relationship::Friend
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Person {
    pub id: String,
    pub name: String,
    pub relationship: Relationship,
    pub upi_id: Option<String>,
    pub phone: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SplitType {
    /// 100% of expense was purchased on behalf of this one person
    BoughtForPerson,
    /// Equal split among participants
    Equal,
    /// Exact amount per participant
    Exact,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SplitParticipant {
    pub person_id: String,
    pub amount_owed: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ExpenseCategory {
    Groceries,
    FoodDining,
    StationeryBooks,
    RoomRentUtilities,
    TravelCab,
    SnacksChai,
    Medical,
    General,
}

impl Default for ExpenseCategory {
    fn default() -> Self {
        ExpenseCategory::General
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum PaymentSource {
    Paytm,
    UpiGeneric,
    Cash,
    Card,
    Other,
}

impl Default for PaymentSource {
    fn default() -> Self {
        PaymentSource::Paytm
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Expense {
    pub id: String,
    pub title: String,
    pub total_amount: f64,
    pub paid_by_id: String, // "me" or a person_id
    pub split_type: SplitType,
    pub splits: Vec<SplitParticipant>,
    pub category: ExpenseCategory,
    pub payment_source: PaymentSource,
    pub date: DateTime<Utc>,
    pub notes: Option<String>,
    pub paytm_reference: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settlement {
    pub id: String,
    pub from_person_id: String,
    pub to_person_id: String,
    pub amount: f64,
    pub date: DateTime<Utc>,
    pub payment_source: PaymentSource,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SimplifiedTransaction {
    pub from_id: String,
    pub from_name: String,
    pub to_id: String,
    pub to_name: String,
    pub amount: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfile {
    pub id: String,
    pub display_name: String,
    pub upi_id: Option<String>,
}

impl Default for UserProfile {
    fn default() -> Self {
        Self {
            id: "me".to_string(),
            display_name: "You".to_string(),
            upi_id: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ThemePreference {
    System,
    Dark,
    Light,
}

impl Default for ThemePreference {
    fn default() -> Self {
        ThemePreference::Dark // Generic dark theme by default
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub theme: ThemePreference,
    pub auto_detect_paytm_clipboard: bool,
    pub currency_symbol: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: ThemePreference::Dark,
            auto_detect_paytm_clipboard: true,
            currency_symbol: "₹".to_string(),
        }
    }
}
