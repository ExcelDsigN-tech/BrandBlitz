//! BrandBlitz escrow contract.
//!
//! Every accumulation of admin- or depositor-supplied `i128` values uses
//! explicit `checked_add` and returns [`ContractError::BalanceOverflow`] on
//! overflow instead of relying on the `overflow-checks = true` release profile.
//! This keeps an overflow a typed contract error that callers can handle and
//! stays correct if a future build profile disables overflow checks.

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token::Client as TokenClient, Address,
    Env, String, Vec,
};

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
    Unauthorized = 7,
    BalanceOverflow = 8,
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
        TokenClient::new(&env, &token).transfer(
            &depositor,
            &env.current_contract_address(),
            &amount,
        );

        let current: i128 = env.storage().instance().get(&DataKey::Balance).unwrap_or(0);
        let new_balance = current
            .checked_add(amount)
            .ok_or(ContractError::BalanceOverflow)?;
        env.storage()
            .instance()
            .set(&DataKey::Balance, &new_balance);
        env.storage()
            .instance()
            .set(&DataKey::Depositor, &depositor);

        env.events()
            .publish((events::DEPOSITED,), (depositor, amount));
        Ok(())
    }

    /// Admin settles the escrow by distributing USDC to winners.
    /// `recipients` is a list of (address, amount) pairs.
    /// Sum of amounts must be <= balance (remainder stays in contract for gas reserve).
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

        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(ContractError::NotInitialized)?;
        let client = TokenClient::new(&env, &token);
        let balance: i128 = env.storage().instance().get(&DataKey::Balance).unwrap_or(0);

        let mut total_distributed: i128 = 0;
        for (recipient, amount) in recipients.iter() {
            if amount <= 0 {
                return Err(ContractError::InvalidAmount);
            }
            total_distributed = total_distributed
                .checked_add(amount)
                .ok_or(ContractError::BalanceOverflow)?;
            if total_distributed > balance {
                return Err(ContractError::InsufficientBalance);
            }
            client.transfer(&env.current_contract_address(), &recipient, &amount);
        }

        env.storage().instance().set(&DataKey::Settled, &true);
        env.storage()
            .instance()
            .set(&DataKey::Balance, &(balance - total_distributed));

        env.events().publish((events::SETTLED,), total_distributed);
        Ok(())
    }

    /// Admin refunds the full balance back to the depositor (e.g. cancelled challenge).
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

    /// View: returns the memo string set at initialization.
    pub fn memo(env: Env) -> String {
        env.storage().instance().get(&DataKey::Memo).unwrap()
    }
}

mod test;
