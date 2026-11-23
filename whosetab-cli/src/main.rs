use std::env;
use std::path::PathBuf;
use whosetab_core::{
    ExpenseCategory, PaymentSource, PaytmParser, Relationship, StorageManager,
};

fn get_data_path() -> PathBuf {
    if let Ok(appdata) = env::var("APPDATA") {
        PathBuf::from(appdata).join("WhoseTab").join("whosetab_data.json")
    } else {
        PathBuf::from("whosetab_data.json")
    }
}

fn print_help() {
    println!(r#"
WhoseTab CLI - Fast, offline peer expense tracking & Paytm transaction logger

USAGE:
    whosetab-cli <COMMAND> [OPTIONS]

COMMANDS:
    summary                 Show overall balances and debtor breakdown
    people                  List all registered friends, roommates, and classmates
    add-person <NAME> [RELATIONSHIP]  Add a person (roommate, classmate, friend)
    snap <AMOUNT> <NAME> [TITLE]      Instantly log a purchase made for someone
    parse "<PAYTM_TEXT>"    Parse Paytm SMS/receipt and extract amount & recipient
    settle <NAME> <AMOUNT>  Record a settlement received from a person
    demo                    Seed demo friends, roommates, and sample expenses
    help                    Show this help message
"#);
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        print_help();
        return;
    }

    let mut storage = StorageManager::new(get_data_path());

    match args[1].as_str() {
        "summary" | "status" | "balance" => {
            let summary = storage.get_overall_summary();
            let balances = storage.get_net_balances();

            println!("\n================ WhoseTab Ledger Summary ================");
            println!("  Total You Are Owed:  ₹{:.2}", summary.total_owed_to_me);
            println!("  Total You Owe:       ₹{:.2}", summary.total_i_owe);
            println!("  Total Tracked:       ₹{:.2}", summary.total_expenses_recorded);
            println!("  Active Debtors:      {}", summary.active_debtor_count);
            println!("=========================================================");

            if balances.is_empty() {
                println!("\nNo balances yet! Use 'snap' or 'demo' to record expenses.\n");
            } else {
                println!("\n--- Individual Balances ---");
                for (id, balance) in &balances {
                    if let Some(person) = storage.get_person(id) {
                        let rel = format!("{:?}", person.relationship);
                        if *balance > 0.0 {
                            println!("  [+] {:<16} ({:<9}) owes you:   ₹{:.2}", person.name, rel, balance);
                        } else if *balance < 0.0 {
                            println!("  [-] {:<16} ({:<9}) you owe:    ₹{:.2}", person.name, rel, balance.abs());
                        } else {
                            println!("  [=] {:<16} ({:<9}) settled up: ₹0.00", person.name, rel);
                        }
                    }
                }
                println!();
            }
        }

        "people" | "list-people" => {
            println!("\nRegistered People ({} total):", storage.ledger.people.len());
            for p in &storage.ledger.people {
                println!("  - {} [{:?}] ID: {}", p.name, p.relationship, p.id);
            }
            println!();
        }

        "add-person" => {
            if args.len() < 3 {
                eprintln!("Error: Missing name. Usage: whosetab-cli add-person <NAME> [roommate|classmate|friend]");
                return;
            }
            let name = &args[2];
            let rel = if args.len() >= 4 {
                match args[3].to_lowercase().as_str() {
                    "roommate" => Relationship::Roommate,
                    "classmate" => Relationship::Classmate,
                    _ => Relationship::Friend,
                }
            } else {
                Relationship::Friend
            };

            match storage.add_person(name, rel, None, None) {
                Ok(p) => println!("Added {} ({:?}) to WhoseTab! [ID: {}]", p.name, p.relationship, p.id),
                Err(e) => eprintln!("Error adding person: {}", e),
            }
        }

        "snap" => {
            if args.len() < 4 {
                eprintln!("Error: Usage: whosetab-cli snap <AMOUNT> <NAME> [TITLE]");
                return;
            }
            let amount: f64 = match args[2].parse() {
                Ok(a) => a,
                Err(_) => {
                    eprintln!("Error: Invalid amount '{}'", args[2]);
                    return;
                }
            };
            let name_query = &args[3];
            let title = if args.len() >= 5 {
                args[4..].join(" ")
            } else {
                "Purchase".to_string()
            };

            // Find matching person
            let person = storage.ledger.people.iter().find(|p| {
                p.name.eq_ignore_ascii_case(name_query) || p.name.to_lowercase().contains(&name_query.to_lowercase())
            }).cloned();

            let target_person = match person {
                Some(p) => p,
                None => {
                    println!("Person '{}' not found. Creating new contact...", name_query);
                    storage.add_person(name_query, Relationship::Friend, None, None)
                        .expect("Failed to create person")
                }
            };

            match storage.snap_purchase_for_person(
                &target_person.id,
                amount,
                &title,
                ExpenseCategory::General,
                None,
            ) {
                Ok(_) => {
                    println!("\n Snapped! Logged ₹{:.2} for '{}' ({})", amount, target_person.name, title);
                    let balances = storage.get_net_balances();
                    let net = balances.get(&target_person.id).unwrap_or(&0.0);
                    println!("   {} now owes you: ₹{:.2}\n", target_person.name, net);
                }
                Err(e) => eprintln!("Error snapping expense: {}", e),
            }
        }

        "parse" => {
            if args.len() < 3 {
                eprintln!("Error: Usage: whosetab-cli parse \"<PAYTM_NOTIFICATION_OR_SMS>\"");
                return;
            }
            let input = &args[2];
            println!("\nAnalyzing Paytm text:\n  \"{}\"", input);

            match PaytmParser::parse_text(input) {
                Some(parsed) => {
                    println!("\n Extracted Paytm Payment:");
                    println!("  Amount:             ₹{:.2}", parsed.amount);
                    println!("  Recipient/Merchant: {}", parsed.recipient.as_deref().unwrap_or("Unknown"));
                    println!("  Suggested Category: {:?}", parsed.suggested_category);
                    if let Some(ref tid) = parsed.transaction_id {
                        println!("  Transaction ID:     {}", tid);
                    }
                    println!("\n-> To snap this to a friend, run:");
                    println!("   whosetab-cli snap {:.2} \"<Friend_Name>\" \"{}\"\n", parsed.amount, parsed.recipient.as_deref().unwrap_or("Paytm Expense"));
                }
                None => {
                    eprintln!("Could not extract payment information from input.");
                }
            }
        }

        "settle" => {
            if args.len() < 4 {
                eprintln!("Error: Usage: whosetab-cli settle <NAME> <AMOUNT>");
                return;
            }
            let name_query = &args[2];
            let amount: f64 = match args[3].parse() {
                Ok(a) => a,
                Err(_) => {
                    eprintln!("Error: Invalid amount '{}'", args[3]);
                    return;
                }
            };

            let person = storage.ledger.people.iter().find(|p| {
                p.name.eq_ignore_ascii_case(name_query) || p.name.to_lowercase().contains(&name_query.to_lowercase())
            }).cloned();

            match person {
                Some(p) => {
                    match storage.record_settlement(&p.id, amount, Some("Settled via CLI".to_string()), PaymentSource::Paytm) {
                        Ok(_) => {
                            let balances = storage.get_net_balances();
                            let net = balances.get(&p.id).unwrap_or(&0.0);
                            println!("\n Recorded settlement of ₹{:.2} from {}!", amount, p.name);
                            println!("   Remaining balance: ₹{:.2}\n", net);
                        }
                        Err(e) => eprintln!("Error recording settlement: {}", e),
                    }
                }
                None => eprintln!("Person '{}' not found.", name_query),
            }
        }

        "demo" => {
            println!("\nSeeding demo data for Roommates, Classmates, and Friends in WhoseTab...");
            let r1 = storage.add_person("Aman Verma", Relationship::Roommate, Some("aman@paytm".to_string()), None).unwrap();
            let r2 = storage.add_person("Kabir Mehta", Relationship::Roommate, Some("kabir@upi".to_string()), None).unwrap();
            let c1 = storage.add_person("Sneha Patel", Relationship::Classmate, None, None).unwrap();
            let f1 = storage.add_person("Rohan Gupta", Relationship::Friend, None, None).unwrap();

            storage.snap_purchase_for_person(&r1.id, 450.0, "Monthly Wifi Bill", ExpenseCategory::RoomRentUtilities, Some("PT9182374".to_string())).unwrap();
            storage.snap_purchase_for_person(&r2.id, 280.0, "Milk & Groceries", ExpenseCategory::Groceries, Some("PT102938".to_string())).unwrap();
            storage.snap_purchase_for_person(&c1.id, 160.0, "Lab Manual & Xerox", ExpenseCategory::StationeryBooks, None).unwrap();
            storage.snap_purchase_for_person(&f1.id, 120.0, "Canteen Samosa & Chai", ExpenseCategory::SnacksChai, None).unwrap();

            println!(" Demo data loaded successfully!");
            println!("Run 'whosetab-cli summary' to inspect the updated ledger.\n");
        }

        _ => {
            eprintln!("Unknown command '{}'", args[1]);
            print_help();
        }
    }
}
