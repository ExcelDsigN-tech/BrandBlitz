#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token::Client as TokenClient, Address,
    Env, String, Vec,
};

/// Contract errors returned by Soroban contract functions.
///
/// Note: Caller authorization failures (e.g., non-admin calling `settle` or `refund`,
/// or non-depositor calling `deposit`) are enforced via Soroban SDK's `Address::require_auth()`.
/// These checks do not return a typed `ContractError::Unauthorized`; instead, Soroban host
/// aborts/panics the transaction on auth failure, surfacing as a host trap to callers.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    AlreadySettled = 3,
    InvalidAmount = 4,
    InsufficientBalance = 5,
    NothingToRefund = 6,
    DepositorMismatch = 7,
    NoRecipients = 8,
    UndistributedBalance = 9,
}

/// Storage keys
#[contracttype]
pub enum DataKey {
    Admin,
    Token, // USDC contract address
    Balance,
    Memo,
    Depositor,
    Settled,
}

/// Events emitted by the contract
mod events {
    pub const DEPOSITED: &str = "deposited";
    pub const SETTLED: &str = "settled";
    pub const REFUNDED: &str = "refunded";
}

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Initialize the escrow.
    /// - `admin`    : the BrandBlitz hot-wallet address authorised to settle/refund
    /// - `token`    : the USDC SAC contract address on this network
    /// - `memo`     : unique challenge memo so Horizon events can be correlated
    pub fn initialize(
        env: Env,
        admin: Address,
        token: Address,
        memo: String,
    ) -> Result<(), ContractError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Memo, &memo);
        env.storage().instance().set(&DataKey::Settled, &false);
        env.storage().instance().set(&DataKey::Balance, &0_i128);
        Ok(())
    }

    /// Brand calls this to deposit USDC into escrow.
    /// The brand must have already approved `amount` for this contract.
    ///
    /// Multi-depositor policy: To ensure refunds return funds to their rightful owner,
    /// only the initial depositor may make subsequent top-up deposits. Deposits from
    /// any other address will be rejected with `ContractError::DepositorMismatch`.
    pub fn deposit(env: Env, depositor: Address, amount: i128) -> Result<(), ContractError> {
        depositor.require_auth();

        if amount <= 0 {
            return Err(ContractError::InvalidAmount);
        }
        if env
            .storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::Settled)
            .unwrap_or(false)
        {
            return Err(ContractError::AlreadySettled);
        }

        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(ContractError::NotInitialized)?;

        if let Some(existing_depositor) = env
            .storage()
            .instance()
            .get::<DataKey, Address>(&DataKey::Depositor)
        {
            if existing_depositor != depositor {
                return Err(ContractError::DepositorMismatch);
            }
        }

        TokenClient::new(&env, &token).transfer(
            &depositor,
            &env.current_contract_address(),
            &amount,
        );

        let current: i128 = env.storage().instance().get(&DataKey::Balance).unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::Balance, &(current + amount));
        env.storage()
            .instance()
            .set(&DataKey::Depositor, &depositor);

        env.events()
            .publish((events::DEPOSITED,), (depositor, amount));
        Ok(())
    }

    /// Admin settles the escrow by distributing USDC to winners.
    /// `recipients` is a list of (address, amount) pairs.
    /// Sum of amounts must equal balance exactly to prevent permanently locking funds.
    /// Rejects empty recipients with `ContractError::NoRecipients` and partial settlement
    /// with `ContractError::UndistributedBalance`.
    pub fn settle(env: Env, recipients: Vec<(Address, i128)>) -> Result<(), ContractError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::NotInitialized)?;
        admin.require_auth();

        if env
            .storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::Settled)
            .unwrap_or(false)
        {
            return Err(ContractError::AlreadySettled);
        }

        if recipients.is_empty() {
            return Err(ContractError::NoRecipients);
        }

        let balance: i128 = env.storage().instance().get(&DataKey::Balance).unwrap_or(0);

        let mut total_to_distribute: i128 = 0;
        for (_, amount) in recipients.iter() {
            if amount <= 0 {
                return Err(ContractError::InvalidAmount);
            }
            total_to_distribute = total_to_distribute
                .checked_add(amount)
                .ok_or(ContractError::InvalidAmount)?;
        }

        if total_to_distribute < balance {
            return Err(ContractError::UndistributedBalance);
        }
        if total_to_distribute > balance {
            return Err(ContractError::InsufficientBalance);
        }

        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(ContractError::NotInitialized)?;
        let client = TokenClient::new(&env, &token);

        for (recipient, amount) in recipients.iter() {
            client.transfer(&env.current_contract_address(), &recipient, &amount);
        }

        env.storage().instance().set(&DataKey::Settled, &true);
        env.storage().instance().set(&DataKey::Balance, &0_i128);

        env.events().publish((events::SETTLED,), total_to_distribute);
        Ok(())
    }

    /// Admin refunds the full balance back to the depositor (e.g. cancelled challenge).
    /// Multi-depositor policy: Since only a single depositor is permitted to deposit into
    /// the escrow, 100% of the pooled balance is returned to that recorded depositor.
    pub fn refund(env: Env) -> Result<(), ContractError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::NotInitialized)?;
        admin.require_auth();

        if env
            .storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::Settled)
            .unwrap_or(false)
        {
            return Err(ContractError::AlreadySettled);
        }

        let balance: i128 = env.storage().instance().get(&DataKey::Balance).unwrap_or(0);
        if balance == 0 {
            return Err(ContractError::NothingToRefund);
        }

        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(ContractError::NotInitialized)?;
        let depositor: Address = env
            .storage()
            .instance()
            .get(&DataKey::Depositor)
            .ok_or(ContractError::NotInitialized)?;

        TokenClient::new(&env, &token).transfer(
            &env.current_contract_address(),
            &depositor,
            &balance,
        );

        env.storage().instance().set(&DataKey::Settled, &true);
        env.storage().instance().set(&DataKey::Balance, &0_i128);

        env.events()
            .publish((events::REFUNDED,), (depositor, balance));
        Ok(())
    }

    /// View: returns the current escrowed USDC balance.
    pub fn balance(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::Balance).unwrap_or(0)
    }

    /// View: returns whether the escrow has been settled or refunded.
    pub fn is_settled(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Settled)
            .unwrap_or(false)
    }

    /// View: returns the memo string set at initialization, or an empty string if uninitialized.
    pub fn memo(env: Env) -> String {
        env.storage()
            .instance()
            .get(&DataKey::Memo)
            .unwrap_or_else(|| String::from_str(&env, ""))
    }
}

mod test;
