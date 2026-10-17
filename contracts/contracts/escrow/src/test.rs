#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events},
    token, vec, Address, Env, IntoVal, String, Val,
};

/// Minimal token double with a no-op transfer so repeated deposits can drive
/// the escrow's own balance accumulator to overflow.
#[contract]
pub struct MockToken;

#[contractimpl]
impl MockToken {
    pub fn transfer(_env: Env, _from: Address, _to: Address, _amount: i128) {}
}

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

fn setup_env() -> (
    Env,
    Address,
    Address,
    Address,
    token::Client<'static>,
    token::StellarAssetClient<'static>,
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

    (
        env,
        admin,
        brand,
        usdc.address.clone(),
        usdc,
        usdc_admin,
        client,
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
    let (env, admin, brand, token, usdc, _usdc_admin, client) = setup_env();
    (env, admin, brand, token, usdc, client)
}

fn setup_mock_token() -> (Env, Address, Address, EscrowContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token = env.register(MockToken, ());
    let contract_id = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract_id);

    (env, admin, token, client)
}

fn topic(env: &Env, name: &str) -> Vec<Val> {
    vec![env, String::from_str(env, name).into_val(env)]
}

fn assert_contract_events(env: &Env, contract: &Address, expected: Vec<(Address, Vec<Val>, Val)>) {
    assert_eq!(env.events().all().filter_by_contract(contract), expected);
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

    let contract = client.address.clone();
    assert_contract_events(
        &env,
        &contract,
        vec![
            &env,
            (
                contract.clone(),
                topic(&env, events::DEPOSITED),
                (brand.clone(), 100_0000000_i128).into_val(&env),
            ),
        ],
    );

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

    let contract = client.address.clone();
    assert_contract_events(
        &env,
        &contract,
        vec![
            &env,
            (
                contract.clone(),
                topic(&env, events::SETTLED),
                100_0000000_i128.into_val(&env),
            ),
        ],
    );

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

    let contract = client.address.clone();
    assert_contract_events(
        &env,
        &contract,
        vec![
            &env,
            (
                contract.clone(),
                topic(&env, events::REFUNDED),
                (brand.clone(), 200_0000000_i128).into_val(&env),
            ),
        ],
    );

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
fn test_settle_empty_recipients() {
    let (env, admin, brand, token, usdc, client) = setup();
    client.initialize(
        &admin,
        &token,
        &String::from_str(&env, "BLITZ-EMPTY-RECIPIENTS"),
    );
    client.deposit(&brand, &100_0000000_i128);

    let recipients: Vec<(Address, i128)> = vec![&env];
    client.settle(&recipients);

    // Issue 886: settling with no recipients still flips the escrow to settled
    // while the full balance is left stranded in the contract.
    assert!(client.is_settled());
    assert_eq!(client.balance(), 100_0000000_i128);
    assert_eq!(usdc.balance(&client.address), 100_0000000_i128);
}

#[test]
fn test_settle_partial_distribution() {
    let (env, admin, brand, token, usdc, client) = setup();
    let winner = Address::generate(&env);
    client.initialize(&admin, &token, &String::from_str(&env, "BLITZ-PARTIAL"));
    client.deposit(&brand, &100_0000000_i128);

    let recipients = vec![&env, (winner.clone(), 30_0000000_i128)];
    client.settle(&recipients);

    assert!(client.is_settled());
    assert_eq!(client.balance(), 70_0000000_i128);
    assert_eq!(usdc.balance(&winner), 30_0000000_i128);
    assert_eq!(usdc.balance(&client.address), 70_0000000_i128);
}

#[test]
fn test_refund_multiple_depositors() {
    let (env, admin, brand, token, usdc, client) = setup();
    let depositor_a = Address::generate(&env);
    let depositor_b = Address::generate(&env);
    client.initialize(
        &admin,
        &token,
        &String::from_str(&env, "BLITZ-MULTI-REFUND"),
    );

    usdc.transfer(&brand, &depositor_a, &100_0000000_i128);
    usdc.transfer(&brand, &depositor_b, &200_0000000_i128);
    client.deposit(&depositor_a, &100_0000000_i128);
    client.deposit(&depositor_b, &200_0000000_i128);
    assert_eq!(client.balance(), 300_0000000_i128);

    let depositor_a_before = usdc.balance(&depositor_a);
    let depositor_b_before = usdc.balance(&depositor_b);
    client.refund();

    // Issue 887: refund() sends the whole balance to the last recorded
    // depositor, so the earlier depositor is not made whole.
    assert!(client.is_settled());
    assert_eq!(client.balance(), 0);
    assert_eq!(usdc.balance(&depositor_a), depositor_a_before);
    assert_eq!(
        usdc.balance(&depositor_b),
        depositor_b_before + 300_0000000_i128
    );
}

#[test]
fn test_settle_multiple_depositors() {
    let (env, admin, brand, token, usdc, client) = setup();
    let depositor_a = Address::generate(&env);
    let depositor_b = Address::generate(&env);
    let winner = Address::generate(&env);
    client.initialize(
        &admin,
        &token,
        &String::from_str(&env, "BLITZ-MULTI-SETTLE"),
    );

    usdc.transfer(&brand, &depositor_a, &100_0000000_i128);
    usdc.transfer(&brand, &depositor_b, &200_0000000_i128);
    client.deposit(&depositor_a, &100_0000000_i128);
    client.deposit(&depositor_b, &200_0000000_i128);

    let recipients = vec![&env, (winner.clone(), 300_0000000_i128)];
    client.settle(&recipients);

    assert!(client.is_settled());
    assert_eq!(client.balance(), 0);
    assert_eq!(usdc.balance(&winner), 300_0000000_i128);
}

#[test]
fn test_deposit_overflow_fails() {
    let (env, admin, token, client) = setup_mock_token();
    let depositor = Address::generate(&env);
    client.initialize(
        &admin,
        &token,
        &String::from_str(&env, "BLITZ-DEP-OVERFLOW"),
    );

    client.deposit(&depositor, &i128::MAX);
    assert_eq!(client.balance(), i128::MAX);

    assert_eq!(
        client.try_deposit(&depositor, &1_i128),
        Err(Ok(ContractError::BalanceOverflow))
    );
}

#[test]
fn test_settle_overflow_fails() {
    let (env, admin, _, token, _, usdc_admin, client) = setup_env();
    let depositor = Address::generate(&env);
    let winner1 = Address::generate(&env);
    let winner2 = Address::generate(&env);
    client.initialize(
        &admin,
        &token,
        &String::from_str(&env, "BLITZ-SETTLE-OVERFLOW"),
    );

    usdc_admin.mint(&depositor, &i128::MAX);
    client.deposit(&depositor, &i128::MAX);
    assert_eq!(client.balance(), i128::MAX);

    let recipients = vec![
        &env,
        (winner1.clone(), i128::MAX),
        (winner2.clone(), 1_i128),
    ];
    assert_eq!(
        client.try_settle(&recipients),
        Err(Ok(ContractError::BalanceOverflow))
    );
}
