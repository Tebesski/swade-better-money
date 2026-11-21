# SWADE Better Money

Enable **SWADE Better Money** in a SWADE world on Foundry v14. Open **Game Settings → Configure Settings → SWADE Better Money → Currency Catalog** as GM.

1. Add each currency with a name and a mark for its balance. The mark can be up to three text characters or up to three images. Images take precedence in the icon slot. The primary currency supplies SWADE’s built-in numeric balance.
2. Click **Add Denomination** to create an Item in the **Better Money Denominations** world compendium. Set its currency, face value, tier, and optional weight per piece. Click the large image to change it. Tier 1 is highest. **Save Denomination** saves and closes the catalog editor. Drag the Item onto an actor sheet to create an independent copy. Denominations opened from inventory or directly from the compendium save changes automatically on the entry being edited.
3. Add an exchange rate by entering equal amounts in two currencies, for example **100 Yen = 1 Credit**. Each pair works in both directions. Amounts support up to six decimal places. Exchanges require an exact result that can be paid out in Items.
4. Open **Manage Money** in the actor’s inventory. Choose an operation, preview the pieces taken and credited, then confirm. A transfer to a player character you don’t own uses the active GM’s connection.

For example, select a tier-2 5,000 note in **Break** to see options for two tier-3 2,500 notes or five tier-4 1,000 notes. In **Combine**, choose the denomination and quantity you want, then pick which smaller pieces to use. Review the pieces taken and added before confirming.

With SWADE Better Effects enabled, enter comma-separated flags below a denomination’s description. Money also supplies flags based on its current currency and face value, such as `yuan` and `yuan-100`.

The catalog can create a **Manage Money** script macro for the Macros directory. Drag it to your hotbar. It uses the selected token’s actor or your assigned character and follows Foundry’s script macro permissions.

Existing SWADE numeric balances are preserved in the source data. Add matching denomination Items to bring those balances into the new inventory totals. With **SWADE Better Setting** enabled, the money windows follow its **SWADE sheet and roll theme** preference, including **White (Porcelain)**.

## Immersive Economy

The **Immersive Economy** world setting is off by default. Enable it under **SWADE Better Money**. **Configure Immersive Economy** edits the currency, purchase tiers, monthly costs and lifestyle effects, gig rewards, and hustle outcomes. The default formulas follow [SWADE: Immersive Economy](https://docs.google.com/document/d/16-OtB0EGn6ZplKtBwtsEoDYeTmoKMTXelncWy6hmIHE/edit?usp=sharing).

- The first activation installs the **Yuan** example. **Install Yuan Example** is also available independently. The ruleset gives prices in yuan without specifying physical denominations. The preset includes editable coins and notes down to 1¥ and uses Foundry’s existing coin icon.
- Priced SWADE items show a **Tier** selector. Existing prices suggest a tier and are kept in the item data. In **Manage Money → Spend → Plan Spending**, enter a fixed amount, build a tier basket, and select any bills to include. The total and remaining balance show a tilde when a selected purchase requires a roll. Each purchase rolls individually and a Bennie rerolls the basket, keeping the lower total.
- **About → Upkeep** sets one lifestyle and any recurring obligations. Bills come due on the first of the in-game month and unpaid months carry forward. Payment is confirmed in **Manage Money**. Paid lifestyles apply their effects. Comfortable grants a claimable Bennie for the paid month, and Wealthy raises the Bennie maximum during the paid month.
- **Hustle** rolls a relevant SWADE skill, applies the outcome and exhaustion, and offers a Bennie reroll of the reward with the higher amount kept. One attempt is available per in-game week. Uncollected rewards can be reopened. The GM decides the complication on a critical failure.
- **Use Hustles for SWADE HUD Earn** routes HUD Earn to this system when the variant is enabled. The activity name is editable. Paid Poor and Destitute lifestyles grant Anemic and block the HUD’s **Natural Healing** activity. The settings menu can create a player **Hustle** macro.
- Use **Token Controls → Better Money → Award Players** to roll gig or hustle rewards separately for each selected character.

Use Foundry’s world clock or Simple Calendar Reborn. Custom formulas support ordinary dice and arithmetic, with fixed amounts for monthly bills. The variant uses exact denomination payouts and payments, so check that the selected rules currency has sufficiently small denominations.

## Bargaining

With Immersive Economy enabled, open **Token Controls → Better Money → Bargaining** as GM. Choose the job, employer attitude, online player, and character. Enter or roll the base reward. The maximum extra request fills in at twice the base reward and can be edited. The GM rolls the employer’s limit privately, sets a signed Notice modifier, and can enter comma-separated Better Effects opposition flags. Edit each job’s limit formula and Neutral interval in **Configure Immersive Economy**. The **Bargaining skills** preference accepts comma-separated skill names or SWADE IDs.

The invited player has 30 minutes to make an offer. Notice and Proposition use SWADE’s roll window and support Benny rerolls. If the character lacks a configured bargaining skill, Proposition uses an Unskilled Attempt. Notice success shades an approximate range and a raise reveals the exact limit. The offer locks when the Proposition roll window opens. The GM sees the private details in a live window, and the final reward is posted in chat for manual settlement.

Other players automatically get a read-only spectator window. It follows the current offer, Notice clues, and negotiation outcome.

## Tier Appearance

Open **Game Settings → Configure Settings → SWADE Better Money → Tier Appearance**. Edit item or denomination tiers in their own tabs. Each card previews its name colour, border, inner aura, and text shadow as you edit. Use the gear to open Shadow Settings, then use **Save Appearance** to save all edited tiers. Item styles follow the same tier the item sheet displays. Denomination styles use their numeric tier across currencies.

Styles are cosmetic and work independently of the Immersive Economy toggle. They appear on SWADE item sheets and inventories, including **SWADE Grid Inventory** and **SWADE HUD** when enabled. The colour presets, shadow options, and six border images come from [PF2e Aztec’s Precious](https://github.com/Tebesski/pf2e-aztecs-precious). Better Money includes the original images and keeps their colours.
