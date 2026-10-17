#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, token, vec, Address, Env, String};

fn create_token<'a>(
    env: &Env,
    admin: &Address,
) -> (token::Client<'a>, token::StellarAssetClient<'a>) {
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    (
        token::Client::new(env, &sac.address()),
        token::StellarAssetClient::new(env, &sac.address()),
    )
}

fn setup() -> (
    Env,
    Address,
    Address,
    Address,
    token::Client<'static>,
    EscrowContractClient<'static>,
) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let brand = Address::generate(&env);
    let (usdc, usdc_admin) = create_token(&env, &admin);
    usdc_admin.mint(&brand, &1_000_0000000_i128);

    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);

    (env, admin, brand, usdc.address.clone(), usdc, client)
}

#[test]
fn test_initialize() {
    let (env, admin, _, token, _, client) = setup();
    let memo = String::from_str(&env, "BLITZ-INIT");

    assert_eq!(client.try_initialize(&admin, &token, &memo), Ok(Ok(())));
    assert_eq!(client.memo(), memo);
    assert!(!client.is_settled());
    assert_eq!(client.balance(), 0);
}

#[test]
fn test_initialize_twice_fails() {
    let (env, admin, _, token, _, client) = setup();
    let memo = String::from_str(&env, "BLITZ-DUP");

    client.initialize(&admin, &token, &memo);
    assert_eq!(
        client.try_initialize(&admin, &token, &memo),
        Err(Ok(ContractError::AlreadyInitialized))
    );
}

#[test]
fn test_deposit_and_views() {
    let (env, admin, brand, token, _, client) = setup();
    client.initialize(&admin, &token, &String::from_str(&env, "BLITZ-VIEWS"));

    client.deposit(&brand, &100_0000000_i128);
    assert_eq!(client.balance(), 100_0000000_i128);
    assert!(!client.is_settled());
}

#[test]
fn test_deposit_zero_fails() {
    let (env, admin, brand, token, _, client) = setup();
    client.initialize(&admin, &token, &String::from_str(&env, "BLITZ-ZERO"));

    assert_eq!(
        client.try_deposit(&brand, &0_i128),
        Err(Ok(ContractError::InvalidAmount))
    );
}

#[test]
fn test_deposit_negative_fails() {
    let (env, admin, brand, token, _, client) = setup();
    client.initialize(&admin, &token, &String::from_str(&env, "BLITZ-NEG"));

    assert_eq!(
        client.try_deposit(&brand, &-10_i128),
        Err(Ok(ContractError::InvalidAmount))
    );
}

#[test]
fn test_deposit_auth_check() {
    let (env, admin, brand, token, _, client) = setup();
    client.initialize(&admin, &token, &String::from_str(&env, "BLITZ-AUTH"));

    env.mock_auths(&[]);
    assert!(client.try_deposit(&brand, &100_0000000_i128).is_err());
}

#[test]
fn test_settle_happy_path() {
    let (env, admin, brand, token, usdc, client) = setup();
    let winner1 = Address::generate(&env);
    let winner2 = Address::generate(&env);

    client.initialize(&admin, &token, &String::from_str(&env, "BLITZ-SETTLE"));
    client.deposit(&brand, &100_0000000_i128);

    let recipients = vec![
        &env,
        (winner1.clone(), 60_0000000_i128),
        (winner2.clone(), 40_0000000_i128),
    ];
    client.settle(&recipients);

    assert!(client.is_settled());
    assert_eq!(client.balance(), 0_i128);
    assert_eq!(usdc.balance(&winner1), 60_0000000_i128);
    assert_eq!(usdc.balance(&winner2), 40_0000000_i128);
}

#[test]
fn test_settle_non_admin_fails() {
    let (env, admin, brand, token, _, client) = setup();
    let winner = Address::generate(&env);
    client.initialize(&admin, &token, &String::from_str(&env, "BLITZ-NONADMIN"));
    client.deposit(&brand, &100_0000000_i128);

    let recipients = vec![&env, (winner.clone(), 100_0000000_i128)];

    env.mock_auths(&[]); // no auth
    assert!(client.try_settle(&recipients).is_err());
}

#[test]
fn test_settle_already_settled() {
    let (env, admin, brand, token, _, client) = setup();
    let winner = Address::generate(&env);
    client.initialize(&admin, &token, &String::from_str(&env, "BLITZ-DUP-SETTLE"));
    client.deposit(&brand, &100_0000000_i128);

    let recipients = vec![&env, (winner.clone(), 100_0000000_i128)];
    client.settle(&recipients);

    assert_eq!(
        client.try_settle(&recipients),
        Err(Ok(ContractError::AlreadySettled))
    );
}

#[test]
fn test_settle_insufficient_balance() {
    let (env, admin, brand, token, _, client) = setup();
    let winner = Address::generate(&env);
    client.initialize(&admin, &token, &String::from_str(&env, "BLITZ-OVERDRAW"));
    client.deposit(&brand, &50_0000000_i128);

    let recipients = vec![&env, (winner.clone(), 100_0000000_i128)];
    assert_eq!(
        client.try_settle(&recipients),
        Err(Ok(ContractError::InsufficientBalance))
    );
}

#[test]
fn test_refund_happy_path() {
    let (env, admin, brand, token, usdc, client) = setup();
    client.initialize(&admin, &token, &String::from_str(&env, "BLITZ-REFUND"));
    client.deposit(&brand, &200_0000000_i128);

    let balance_before = usdc.balance(&brand);
    client.refund();
    assert!(client.is_settled());
    assert_eq!(client.balance(), 0);
    assert_eq!(usdc.balance(&brand), balance_before + 200_0000000_i128);
}

#[test]
fn test_refund_non_admin_fails() {
    let (env, admin, brand, token, _, client) = setup();
    client.initialize(&admin, &token, &String::from_str(&env, "BLITZ-REFUND-AUTH"));
    client.deposit(&brand, &100_0000000_i128);

    env.mock_auths(&[]);
    assert!(client.try_refund().is_err());
}

#[test]
fn test_refund_nothing_to_refund() {
    let (env, admin, _, token, _, client) = setup();
    client.initialize(&admin, &token, &String::from_str(&env, "BLITZ-EMPTY"));

    assert_eq!(client.try_refund(), Err(Ok(ContractError::NothingToRefund)));
}

#[test]
fn test_deposit_after_settled_fails() {
    let (env, admin, brand, token, _, client) = setup();
    client.initialize(&admin, &token, &String::from_str(&env, "BLITZ-LATE"));
    client.deposit(&brand, &100_0000000_i128);
    client.refund();

    assert_eq!(
        client.try_deposit(&brand, &50_0000000_i128),
        Err(Ok(ContractError::AlreadySettled))
    );
}

#[test]
fn test_memo_before_initialize() {
    let (env, _, _, _, _, client) = setup();
    // Pre-initialization view call returns graceful empty string without panicking
    assert_eq!(client.memo(), String::from_str(&env, ""));
}

#[test]
fn test_memo_after_initialize() {
    let (env, admin, _, token, _, client) = setup();
    let memo = String::from_str(&env, "BLITZ-MEMO-CHECK");
    client.initialize(&admin, &token, &memo);
    assert_eq!(client.memo(), memo);
}

#[test]
fn test_auth_failure_surfaces_as_host_trap() {
    let (env, admin, brand, token, _, client) = setup();
    let winner = Address::generate(&env);
    client.initialize(&admin, &token, &String::from_str(&env, "BLITZ-AUTH-TRAP"));
    client.deposit(&brand, &100_0000000_i128);

    let recipients = vec![&env, (winner.clone(), 100_0000000_i128)];

    // soroban-sdk require_auth failure surfaces as a host trap / panic (is_err()),
    // NOT as a typed Ok(Err(ContractError)).
    env.mock_auths(&[]);
    let res = client.try_settle(&recipients);
    assert!(res.is_err());
    assert!(!matches!(res, Ok(Err(_))));
}

#[test]
fn test_deposit_second_depositor_fails() {
    let (env, admin, brand, token, _, client) = setup();
    let brand2 = Address::generate(&env);
    let sac = token::StellarAssetClient::new(&env, &token);
    sac.mint(&brand2, &500_0000000_i128);

    client.initialize(&admin, &token, &String::from_str(&env, "BLITZ-MULTI-DEP"));
    client.deposit(&brand, &100_0000000_i128);

    // Subsequent top-up deposit from the same depositor succeeds
    client.deposit(&brand, &50_0000000_i128);
    assert_eq!(client.balance(), 150_0000000_i128);

    // Deposit from a different depositor fails with DepositorMismatch
    assert_eq!(
        client.try_deposit(&brand2, &50_0000000_i128),
        Err(Ok(ContractError::DepositorMismatch))
    );
}

#[test]
fn test_settle_empty_recipients_fails() {
    let (env, admin, brand, token, _, client) = setup();
    client.initialize(&admin, &token, &String::from_str(&env, "BLITZ-EMPTY-SETTLE"));
    client.deposit(&brand, &100_0000000_i128);

    let empty_recipients = vec![&env];
    assert_eq!(
        client.try_settle(&empty_recipients),
        Err(Ok(ContractError::NoRecipients))
    );
    // Contract must not be marked settled, balance must remain untouched
    assert!(!client.is_settled());
    assert_eq!(client.balance(), 100_0000000_i128);
}

#[test]
fn test_settle_partial_recipients_fails() {
    let (env, admin, brand, token, _, client) = setup();
    let winner = Address::generate(&env);
    client.initialize(&admin, &token, &String::from_str(&env, "BLITZ-PARTIAL-SETTLE"));
    client.deposit(&brand, &100_0000000_i128);

    // Partial distribution (60 out of 100) must fail with UndistributedBalance
    let recipients = vec![&env, (winner.clone(), 60_0000000_i128)];
    assert_eq!(
        client.try_settle(&recipients),
        Err(Ok(ContractError::UndistributedBalance))
    );
    // Contract must not be marked settled, balance must remain untouched
    assert!(!client.is_settled());
    assert_eq!(client.balance(), 100_0000000_i128);
}

