window.saveTimeout = null;
window.npcRoster = JSON.parse(localStorage.getItem('conflict_npcs') || '[]');

// TODAS AS BLUEPRINTS RESTAURADAS INTEGRALMENTE
window.sheetBlueprints = {
    dnd: `<div class="sheet-row"><input type="text" class="sheet-input dyn-save" data-key="name" placeholder="Character Name" style="font-size: 22px; font-weight: bold; flex: 2; color: var(--accent-main);"><input type="text" class="sheet-input dyn-save" data-key="class" placeholder="Class & Level" style="flex: 1;"><input type="text" class="sheet-input dyn-save" data-key="race" placeholder="Race & Background" style="flex: 1;"></div><div class="sheet-row" style="margin-top: 15px;"><div class="sheet-col" style="flex: 2;"><div class="sheet-row" style="gap: 10px; margin-bottom: 15px;"><div class="sheet-stat-box" style="flex: 1;"><label>Armor Class</label><input type="text" class="dyn-save" data-key="ac"></div><div class="sheet-stat-box" style="flex: 1;"><label class="rollable" data-dice="1d20" data-name="Initiative" data-mod-target="init">Initiative</label><input type="text" class="dyn-save" data-key="init"></div><div class="sheet-stat-box" style="flex: 1;"><label>Speed</label><input type="text" class="dyn-save" data-key="speed"></div><div class="sheet-stat-box" style="flex: 1;"><label>Prof Bonus</label><input type="text" class="dyn-save" data-key="prof" id="dnd-prof" value="2"></div></div><div class="sheet-row" style="gap: 10px; margin-bottom: 15px;"><div class="sheet-stat-box" style="flex: 2;"><label>Current Hit Points</label><input type="text" class="dyn-save" data-key="hp" placeholder="Max / Current" style="font-size: 22px;"></div><div class="sheet-stat-box" style="flex: 1;"><label>Temp HP</label><input type="text" class="dyn-save" data-key="temp_hp"></div><div class="sheet-stat-box" style="flex: 1;"><label>Hit Dice</label><input type="text" class="dyn-save" data-key="hit_dice"></div></div><div class="sheet-box"><h4>Attacks & Spellcasting</h4><textarea class="sheet-textarea dyn-save" data-key="attacks" style="min-height: 120px;" placeholder="Weapon | Atk Bonus | Damage/Type"></textarea></div><div class="sheet-box" style="margin-top: 15px;"><h4>Equipment & Gold</h4><textarea class="sheet-textarea dyn-save" data-key="inventory" style="min-height: 100px;"></textarea></div></div><div class="sheet-col" style="flex: 3;"><div class="sheet-box"><h4>Attributes & Saves</h4><div style="display: flex; gap: 10px; justify-content: space-between; margin-bottom: 15px;"><div class="attr-box"><label class="rollable" data-dice="1d20" data-name="STR Check" data-mod-target="str" data-is-attr="true">STR</label><input type="text" class="dyn-save dnd-attr" data-key="str" id="dnd-str" value="10"></div><div class="attr-box"><label class="rollable" data-dice="1d20" data-name="DEX Check" data-mod-target="dex" data-is-attr="true">DEX</label><input type="text" class="dyn-save dnd-attr" data-key="dex" id="dnd-dex" value="10"></div><div class="attr-box"><label class="rollable" data-dice="1d20" data-name="CON Check" data-mod-target="con" data-is-attr="true">CON</label><input type="text" class="dyn-save dnd-attr" data-key="con" id="dnd-con" value="10"></div><div class="attr-box"><label class="rollable" data-dice="1d20" data-name="INT Check" data-mod-target="int" data-is-attr="true">INT</label><input type="text" class="dyn-save dnd-attr" data-key="int" id="dnd-int" value="10"></div><div class="attr-box"><label class="rollable" data-dice="1d20" data-name="WIS Check" data-mod-target="wis" data-is-attr="true">WIS</label><input type="text" class="dyn-save dnd-attr" data-key="wis" id="dnd-wis" value="10"></div><div class="attr-box"><label class="rollable" data-dice="1d20" data-name="CHA Check" data-mod-target="cha" data-is-attr="true">CHA</label><input type="text" class="dyn-save dnd-attr" data-key="cha" id="dnd-cha" value="10"></div></div><h4>Skills</h4><div class="skills-grid"><div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_acro" data-attr="dex"> <span class="rollable" data-dice="1d20" data-name="Acrobatics" data-mod-target="sk_acro">Acrobatics</span></span><input type="text" class="dyn-save dnd-skill" data-key="sk_acro" readonly></div><div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_anim" data-attr="wis"> <span class="rollable" data-dice="1d20" data-name="Animal Handling" data-mod-target="sk_anim">Animal Hand</span></span><input type="text" class="dyn-save dnd-skill" data-key="sk_anim" readonly></div><div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_arca" data-attr="int"> <span class="rollable" data-dice="1d20" data-name="Arcana" data-mod-target="sk_arca">Arcana</span></span><input type="text" class="dyn-save dnd-skill" data-key="sk_arca" readonly></div><div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_athl" data-attr="str"> <span class="rollable" data-dice="1d20" data-name="Athletics" data-mod-target="sk_athl">Athletics</span></span><input type="text" class="dyn-save dnd-skill" data-key="sk_athl" readonly></div><div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_dece" data-attr="cha"> <span class="rollable" data-dice="1d20" data-name="Deception" data-mod-target="sk_dece">Deception</span></span><input type="text" class="dyn-save dnd-skill" data-key="sk_dece" readonly></div><div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_hist" data-attr="int"> <span class="rollable" data-dice="1d20" data-name="History" data-mod-target="sk_hist">History</span></span><input type="text" class="dyn-save dnd-skill" data-key="sk_hist" readonly></div><div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_ins" data-attr="wis"> <span class="rollable" data-dice="1d20" data-name="Insight" data-mod-target="sk_ins">Insight</span></span><input type="text" class="dyn-save dnd-skill" data-key="sk_ins" readonly></div><div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_inti" data-attr="cha"> <span class="rollable" data-dice="1d20" data-name="Intimidation" data-mod-target="sk_inti">Intimidation</span></span><input type="text" class="dyn-save dnd-skill" data-key="sk_inti" readonly></div><div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_inv" data-attr="int"> <span class="rollable" data-dice="1d20" data-name="Investigation" data-mod-target="sk_inv">Investigation</span></span><input type="text" class="dyn-save dnd-skill" data-key="sk_inv" readonly></div><div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_med" data-attr="wis"> <span class="rollable" data-dice="1d20" data-name="Medicine" data-mod-target="sk_med">Medicine</span></span><input type="text" class="dyn-save dnd-skill" data-key="sk_med" readonly></div><div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_nat" data-attr="int"> <span class="rollable" data-dice="1d20" data-name="Nature" data-mod-target="sk_nat">Nature</span></span><input type="text" class="dyn-save dnd-skill" data-key="sk_nat" readonly></div><div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_perc" data-attr="wis"> <span class="rollable" data-dice="1d20" data-name="Perception" data-mod-target="sk_perc">Perception</span></span><input type="text" class="dyn-save dnd-skill" data-key="sk_perc" readonly></div><div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_perf" data-attr="cha"> <span class="rollable" data-dice="1d20" data-name="Performance" data-mod-target="sk_perf">Performance</span></span><input type="text" class="dyn-save dnd-skill" data-key="sk_perf" readonly></div><div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_pers" data-attr="cha"> <span class="rollable" data-dice="1d20" data-name="Persuasion" data-mod-target="sk_pers">Persuasion</span></span><input type="text" class="dyn-save dnd-skill" data-key="sk_pers" readonly></div><div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_rel" data-attr="int"> <span class="rollable" data-dice="1d20" data-name="Religion" data-mod-target="sk_rel">Religion</span></span><input type="text" class="dyn-save dnd-skill" data-key="sk_rel" readonly></div><div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_slei" data-attr="dex"> <span class="rollable" data-dice="1d20" data-name="Sleight of Hand" data-mod-target="sk_slei">Sleight Hand</span></span><input type="text" class="dyn-save dnd-skill" data-key="sk_slei" readonly></div><div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_ste" data-attr="dex"> <span class="rollable" data-dice="1d20" data-name="Stealth" data-mod-target="sk_ste">Stealth</span></span><input type="text" class="dyn-save dnd-skill" data-key="sk_ste" readonly></div><div class="skill-item"><span><input type="checkbox" class="prof-toggle dyn-save" data-key="prof_surv" data-attr="wis"> <span class="rollable" data-dice="1d20" data-name="Survival" data-mod-target="sk_surv">Survival</span></span><input type="text" class="dyn-save dnd-skill" data-key="sk_surv" readonly></div></div></div><div class="sheet-box" style="margin-top: 15px;"><h4>Features, Traits & Proficiencies</h4><textarea class="sheet-textarea dyn-save" data-key="features" style="min-height: 150px;"></textarea></div></div></div>`,
    daggerheart: `<div class="sheet-row"><input type="text" class="sheet-input dyn-save" data-key="name" placeholder="Character Name" style="font-size: 20px; font-weight: bold; flex: 2; color: var(--accent-main);"><input type="text" class="sheet-input dyn-save" data-key="class" placeholder="Class & Subclass" style="flex: 2;"><input type="text" class="sheet-input dyn-save" data-key="level" placeholder="Level" style="flex: 1;"></div><div class="sheet-row" style="margin: 15px 0; gap: 10px;"><div class="sheet-stat-box" style="flex: 1;"><label>HOPE</label><input type="text" class="dyn-save" data-key="hope"></div><div class="sheet-stat-box" style="flex: 1; border-color: #ef4444;"><label>FEAR</label><input type="text" class="dyn-save" data-key="fear" style="color: #ef4444;"></div><div class="sheet-stat-box" style="flex: 1;"><label>HP</label><input type="text" class="dyn-save" data-key="hp"></div><div class="sheet-stat-box" style="flex: 1;"><label>STRESS</label><input type="text" class="dyn-save" data-key="stress"></div><div class="sheet-stat-box" style="flex: 1.5;"><label class="rollable" data-dice="1d20" data-name="Evasion" data-mod-target="evasion">EVASION</label><div style="display:flex; gap:5px; align-items:center;"><input type="text" class="dyn-save dh-base-evasion" data-key="base_evasion" placeholder="Base" style="font-size: 12px; border-right: 1px solid var(--border-color); padding-right: 5px;" title="Base Class Evasion"><input type="text" class="dyn-save dh-evasion" data-key="evasion" title="Total Evasion"></div></div><div class="sheet-stat-box" style="flex: 1;"><label>ARMOR</label><input type="text" class="dyn-save" data-key="armor"></div></div><div class="sheet-row"><div class="sheet-col" style="flex: 1;"><div class="sheet-box"><h4>Traits & Attributes</h4><div class="skills-grid" style="grid-template-columns: 1fr;"><div class="skill-item"><span class="rollable" data-dice="2d12" data-name="Agility Roll" data-mod-target="agility">Agility</span><input type="text" class="dyn-save dh-agi" data-key="agility"></div><div class="skill-item"><span class="rollable" data-dice="2d12" data-name="Strength Roll" data-mod-target="strength">Strength</span><input type="text" class="dyn-save" data-key="strength"></div><div class="skill-item"><span class="rollable" data-dice="2d12" data-name="Finesse Roll" data-mod-target="finesse">Finesse</span><input type="text" class="dyn-save" data-key="finesse"></div><div class="skill-item"><span class="rollable" data-dice="2d12" data-name="Instinct Roll" data-mod-target="instinct">Instinct</span><input type="text" class="dyn-save" data-key="instinct"></div><div class="skill-item"><span class="rollable" data-dice="2d12" data-name="Presence Roll" data-mod-target="presence">Presence</span><input type="text" class="dyn-save" data-key="presence"></div><div class="skill-item"><span class="rollable" data-dice="2d12" data-name="Knowledge Roll" data-mod-target="knowledge">Knowledge</span><input type="text" class="dyn-save" data-key="knowledge"></div></div></div><div class="sheet-box" style="margin-top: 15px;"><h4>Experiences</h4><textarea class="sheet-textarea dyn-save" data-key="experiences" style="min-height: 100px;"></textarea></div></div><div class="sheet-col" style="flex: 2;"><div class="sheet-box" style="margin-bottom: 15px;"><h4>Damage Thresholds</h4><div style="display: flex; gap: 10px;"><input type="text" class="sheet-input dyn-save" data-key="minor" placeholder="Minor"><input type="text" class="sheet-input dyn-save" data-key="major" placeholder="Major"><input type="text" class="sheet-input dyn-save" data-key="severe" placeholder="Severe"></div></div><div class="sheet-box" style="margin-bottom: 15px;"><h4>Active Weapons</h4><textarea class="sheet-textarea dyn-save" data-key="weapons" style="min-height: 100px;"></textarea></div><div class="sheet-box"><h4>Domain Cards & Abilities</h4><textarea class="sheet-textarea dyn-save" data-key="abilities" style="min-height: 150px;"></textarea></div></div></div>`,
    aquelarre: `<div class="sheet-row"><input type="text" class="sheet-input dyn-save" data-key="name" placeholder="Name" style="font-size: 20px; font-weight: bold; flex: 2; color: var(--accent-main);"><input type="text" class="sheet-input dyn-save" data-key="profession" placeholder="Social Status / Profession" style="flex: 2;"></div><div class="sheet-row" style="margin: 15px 0; gap: 10px;"><div class="sheet-stat-box" style="flex: 1;"><label class="rollable" data-dice="1d100" data-name="Rationality Test" data-mod-target="rr">Rationality</label><input type="text" class="dyn-save aquelarre-rr" data-key="rr"></div><div class="sheet-stat-box" style="flex: 1; border-color: #ef4444;"><label class="rollable" data-dice="1d100" data-name="Irrationality Test" data-mod-target="irr">Irrationality</label><input type="text" class="dyn-save aquelarre-irr" data-key="irr" style="color: #ef4444;"></div><div class="sheet-stat-box" style="flex: 1;"><label>Health (HP)</label><input type="text" class="dyn-save aquelarre-hp" data-key="hp"></div><div class="sheet-stat-box" style="flex: 1;"><label>Faith Points</label><input type="text" class="dyn-save" data-key="faith"></div><div class="sheet-stat-box" style="flex: 1;"><label class="rollable" data-dice="1d100" data-name="Luck Roll" data-mod-target="luck">Luck</label><input type="text" class="dyn-save" data-key="luck"></div></div><div class="sheet-row"><div class="sheet-col" style="flex: 1;"><div class="sheet-box"><h4>Primary Characteristics</h4><div class="skills-grid" style="grid-template-columns: 1fr;"><div class="skill-item"><span class="rollable" data-dice="1d100" data-name="Strength Check" data-mod-target="str">Strength (STR)</span><input type="text" class="dyn-save aquelarre-str" data-key="str"></div><div class="skill-item"><span class="rollable" data-dice="1d100" data-name="Agility Check" data-mod-target="agi">Agility (AGI)</span><input type="text" class="dyn-save" data-key="agi"></div><div class="skill-item"><span class="rollable" data-dice="1d100" data-name="Dexterity Check" data-mod-target="dex">Dexterity (DEX)</span><input type="text" class="dyn-save" data-key="dex"></div><div class="skill-item"><span class="rollable" data-dice="1d100" data-name="Stamina Check" data-mod-target="sta">Stamina (STA)</span><input type="text" class="dyn-save aquelarre-sta" data-key="sta"></div><div class="skill-item"><span class="rollable" data-dice="1d100" data-name="Perception Check" data-mod-target="per">Perception (PER)</span><input type="text" class="dyn-save" data-key="per"></div><div class="skill-item"><span class="rollable" data-dice="1d100" data-name="Communication Check" data-mod-target="com">Communication (COM)</span><input type="text" class="dyn-save" data-key="com"></div><div class="skill-item"><span class="rollable" data-dice="1d100" data-name="Culture Check" data-mod-target="cul">Culture (CUL)</span><input type="text" class="dyn-save" data-key="cul"></div></div></div></div><div class="sheet-col" style="flex: 2;"><div class="sheet-box" style="margin-bottom: 15px;"><h4>Core Competences</h4><div class="skills-grid"><div class="skill-item"><span class="rollable" data-dice="1d100" data-name="Alertness" data-mod-target="sk_alert">Alertness</span><input type="text" class="dyn-save" data-key="sk_alert"></div><div class="skill-item"><span class="rollable" data-dice="1d100" data-name="Brawl" data-mod-target="sk_brawl">Brawl</span><input type="text" class="dyn-save" data-key="sk_brawl"></div><div class="skill-item"><span class="rollable" data-dice="1d100" data-name="Dodge" data-mod-target="sk_dodge">Dodge</span><input type="text" class="dyn-save" data-key="sk_dodge"></div><div class="skill-item"><span class="rollable" data-dice="1d100" data-name="Empathy" data-mod-target="sk_emp">Empathy</span><input type="text" class="dyn-save" data-key="sk_emp"></div><div class="skill-item"><span class="rollable" data-dice="1d100" data-name="Eloquence" data-mod-target="sk_elo">Eloquence</span><input type="text" class="dyn-save" data-key="sk_elo"></div><div class="skill-item"><span class="rollable" data-dice="1d100" data-name="Listen" data-mod-target="sk_list">Listen</span><input type="text" class="dyn-save" data-key="sk_list"></div><div class="skill-item"><span class="rollable" data-dice="1d100" data-name="Melee Weapons" data-mod-target="sk_melee">Melee Weapons</span><input type="text" class="dyn-save" data-key="sk_melee"></div><div class="skill-item"><span class="rollable" data-dice="1d100" data-name="Memory" data-mod-target="sk_mem">Memory</span><input type="text" class="dyn-save" data-key="sk_mem"></div><div class="skill-item"><span class="rollable" data-dice="1d100" data-name="Missile Weapons" data-mod-target="sk_miss">Missile Weapons</span><input type="text" class="dyn-save" data-key="sk_miss"></div><div class="skill-item"><span class="rollable" data-dice="1d100" data-name="Ride" data-mod-target="sk_ride">Ride</span><input type="text" class="dyn-save" data-key="sk_ride"></div><div class="skill-item"><span class="rollable" data-dice="1d100" data-name="Stealth" data-mod-target="sk_stealth">Stealth</span><input type="text" class="dyn-save" data-key="sk_stealth"></div><div class="skill-item"><span class="rollable" data-dice="1d100" data-name="Theology" data-mod-target="sk_theo">Theology</span><input type="text" class="dyn-save" data-key="sk_theo"></div></div></div><div class="sheet-box"><h4>Spells, Rituals & Inventory</h4><textarea class="sheet-textarea dyn-save" data-key="magic" style="min-height: 150px;"></textarea></div></div></div>`,
    vampire: `<div class="sheet-row"><input type="text" class="sheet-input dyn-save" data-key="name" placeholder="Name" style="font-size: 20px; font-weight: bold; flex: 2; color: #ef4444;"><input type="text" class="sheet-input dyn-save" data-key="clan" placeholder="Clan & Generation" style="flex: 1;"><input type="text" class="sheet-input dyn-save" data-key="concept" placeholder="Concept" style="flex: 1;"></div><div class="sheet-row" style="margin: 15px 0; gap: 10px;"><div class="sheet-stat-box" style="flex: 1;"><label>Health (HP)</label><input type="text" class="dyn-save vamp-hp" data-key="hp"></div><div class="sheet-stat-box" style="flex: 1;"><label>Willpower</label><input type="text" class="dyn-save vamp-will" data-key="will"></div><div class="sheet-stat-box" style="flex: 1; border-color: #ef4444;"><label class="rollable" data-dice="1d10" data-name="Hunger Roll" data-mod-target="hunger">Hunger</label><input type="text" class="dyn-save" data-key="hunger" style="color: #ef4444;"></div><div class="sheet-stat-box" style="flex: 1;"><label class="rollable" data-dice="1d10" data-name="Humanity" data-mod-target="humanity">Humanity</label><input type="text" class="dyn-save" data-key="humanity"></div><div class="sheet-stat-box" style="flex: 1; border-color: #fbbf24;"><label>Blood Potency</label><input type="text" class="dyn-save" data-key="potency" style="color: #fbbf24;"></div></div><div class="sheet-row"><div class="sheet-col" style="flex: 1;"><div class="sheet-box"><h4>Attributes</h4><label style="font-size:10px; color:var(--text-muted);">Physical</label><div class="skills-grid" style="grid-template-columns: 1fr; margin-bottom: 10px;"><div class="skill-item"><span class="rollable" data-dice="1d10" data-name="Strength" data-mod-target="str">Strength</span><input type="text" class="dyn-save" data-key="str"></div><div class="skill-item"><span class="rollable" data-dice="1d10" data-name="Dexterity" data-mod-target="dex">Dexterity</span><input type="text" class="dyn-save" data-key="dex"></div><div class="skill-item"><span class="rollable" data-dice="1d10" data-name="Stamina" data-mod-target="sta">Stamina</span><input type="text" class="dyn-save vamp-sta" data-key="sta"></div></div><label style="font-size:10px; color:var(--text-muted);">Social</label><div class="skills-grid" style="grid-template-columns: 1fr; margin-bottom: 10px;"><div class="skill-item"><span class="rollable" data-dice="1d10" data-name="Charisma" data-mod-target="cha">Charisma</span><input type="text" class="dyn-save" data-key="cha"></div><div class="skill-item"><span class="rollable" data-dice="1d10" data-name="Manipulation" data-mod-target="man">Manipulation</span><input type="text" class="dyn-save" data-key="man"></div><div class="skill-item"><span class="rollable" data-dice="1d10" data-name="Composure" data-mod-target="com">Composure</span><input type="text" class="dyn-save vamp-com" data-key="com"></div></div><label style="font-size:10px; color:var(--text-muted);">Mental</label><div class="skills-grid" style="grid-template-columns: 1fr;"><div class="skill-item"><span class="rollable" data-dice="1d10" data-name="Intelligence" data-mod-target="int">Intelligence</span><input type="text" class="dyn-save" data-key="int"></div><div class="skill-item"><span class="rollable" data-dice="1d10" data-name="Wits" data-mod-target="wit">Wits</span><input type="text" class="dyn-save" data-key="wit"></div><div class="skill-item"><span class="rollable" data-dice="1d10" data-name="Resolve" data-mod-target="res">Resolve</span><input type="text" class="dyn-save vamp-res" data-key="res"></div></div></div></div><div class="sheet-col" style="flex: 2;"><div class="sheet-box" style="margin-bottom: 15px;"><h4>Skills</h4><textarea class="sheet-textarea dyn-save" data-key="skills" style="min-height: 100px;" placeholder="Athletics, Brawl, Firearms, Persuasion, Occult..."></textarea></div><div class="sheet-box"><h4>Disciplines & Advantages</h4><textarea class="sheet-textarea dyn-save" data-key="disciplines" style="min-height: 150px;"></textarea></div></div></div>`,
    assimilacao: `<div class="sheet-row"><input type="text" class="sheet-input dyn-save" data-key="name" placeholder="Nome do Personagem" style="font-size: 20px; font-weight: bold; flex: 2; color: var(--accent-main);"><input type="text" class="sheet-input dyn-save" data-key="player" placeholder="Origem / Jogador" style="flex: 1;"></div><div class="sheet-row" style="margin: 15px 0; gap: 10px;"><div class="sheet-stat-box" style="flex: 1;"><label>Vitalidade</label><input type="text" class="dyn-save ass-hp" data-key="vitality"></div><div class="sheet-stat-box" style="flex: 1;"><label>Saúde Mental</label><input type="text" class="dyn-save ass-mental" data-key="mental_hp"></div><div class="sheet-stat-box" style="flex: 1;"><label>Defesa</label><input type="text" class="dyn-save" data-key="defesa"></div><div class="sheet-stat-box" style="flex: 1;"><label class="rollable" data-dice="1d20" data-name="Teste de Esquiva" data-mod-target="esquiva">Esquiva</label><input type="text" class="dyn-save ass-esq" data-key="esquiva"></div><div class="sheet-stat-box" style="flex: 1;"><label>Velocidade</label><input type="text" class="dyn-save" data-key="velocidade"></div><div class="sheet-stat-box" style="flex: 1;"><label>Carga</label><input type="text" class="dyn-save ass-carga" data-key="carga"></div></div><div class="sheet-row"><div class="sheet-col" style="flex: 1;"><div class="sheet-box"><h4>Atributos Principais</h4><label style="font-size:10px; color:var(--text-muted);">Corpo</label><div class="skills-grid" style="grid-template-columns: 1fr; margin-bottom: 10px;"><div class="skill-item"><span class="rollable" data-dice="1d20" data-name="Força" data-mod-target="forca">Força</span><input type="text" class="dyn-save ass-forca" data-key="forca"></div><div class="skill-item"><span class="rollable" data-dice="1d20" data-name="Agilidade" data-mod-target="agilidade">Agilidade</span><input type="text" class="dyn-save ass-agi" data-key="agilidade"></div><div class="skill-item"><span class="rollable" data-dice="1d20" data-name="Metabolismo" data-mod-target="metabolismo">Metabolismo</span><input type="text" class="dyn-save ass-met" data-key="metabolismo"></div></div><label style="font-size:10px; color:var(--text-muted);">Mente</label><div class="skills-grid" style="grid-template-columns: 1fr; margin-bottom: 10px;"><div class="skill-item"><span class="rollable" data-dice="1d20" data-name="Intelecto" data-mod-target="intelecto">Intelecto</span><input type="text" class="dyn-save ass-int" data-key="intelecto"></div><div class="skill-item"><span class="rollable" data-dice="1d20" data-name="Raciocínio" data-mod-target="raciocinio">Raciocínio</span><input type="text" class="dyn-save" data-key="raciocinio"></div><div class="skill-item"><span class="rollable" data-dice="1d20" data-name="Percepção" data-mod-target="percepcao">Percepção</span><input type="text" class="dyn-save ass-perc" data-key="percepcao"></div></div><label style="font-size:10px; color:var(--text-muted);">Essência</label><div class="skills-grid" style="grid-template-columns: 1fr;"><div class="skill-item"><span class="rollable" data-dice="1d20" data-name="Carisma" data-mod-target="carisma">Carisma</span><input type="text" class="dyn-save" data-key="carisma"></div><div class="skill-item"><span class="rollable" data-dice="1d20" data-name="Manipulação" data-mod-target="manipulacao">Manipulação</span><input type="text" class="dyn-save" data-key="manipulacao"></div><div class="skill-item"><span class="rollable" data-dice="1d20" data-name="Propósito" data-mod-target="proposito">Propósito</span><input type="text" class="dyn-save ass-prop" data-key="proposito"></div></div></div></div><div class="sheet-col" style="flex: 2;"><div class="sheet-box" style="margin-bottom: 15px;"><h4>Aptidões & Perícias</h4><div class="skills-grid"><div class="skill-item"><span class="rollable" data-dice="1d20" data-name="Atletismo" data-mod-target="sk_atl">Atletismo</span><input type="text" class="dyn-save" data-key="sk_atl"></div><div class="skill-item"><span class="rollable" data-dice="1d20" data-name="Furtividade" data-mod-target="sk_fur">Furtividade</span><input type="text" class="dyn-save" data-key="sk_fur"></div><div class="skill-item"><span class="rollable" data-dice="1d20" data-name="Investigação" data-mod-target="sk_inv">Investigação</span><input type="text" class="dyn-save" data-key="sk_inv"></div><div class="skill-item"><span class="rollable" data-dice="1d20" data-name="Luta" data-mod-target="sk_lut">Luta</span><input type="text" class="dyn-save" data-key="sk_lut"></div><div class="skill-item"><span class="rollable" data-dice="1d20" data-name="Medicina" data-mod-target="sk_med">Medicina</span><input type="text" class="dyn-save" data-key="sk_med"></div><div class="skill-item"><span class="rollable" data-dice="1d20" data-name="Mira" data-mod-target="sk_mir">Mira</span><input type="text" class="dyn-save" data-key="sk_mir"></div><div class="skill-item"><span class="rollable" data-dice="1d20" data-name="Sobrevivência" data-mod-target="sk_sob">Sobrevivência</span><input type="text" class="dyn-save" data-key="sk_sob"></div><div class="skill-item"><span class="rollable" data-dice="1d20" data-name="Tecnologia" data-mod-target="sk_tec">Tecnologia</span><input type="text" class="dyn-save" data-key="sk_tec"></div></div></div><div class="sheet-box"><h4>Mutação, Anomalia & Inventário</h4><textarea class="sheet-textarea dyn-save" data-key="skills" style="min-height: 150px;"></textarea></div></div></div>`,
    ordem2: `<div class="sheet-row"><input type="text" class="sheet-input dyn-save" data-key="name" placeholder="Nome do Personagem" style="font-size: 22px; font-weight: bold; flex: 2; color: var(--accent-main);"><input type="text" class="sheet-input dyn-save" data-key="origin" placeholder="Origem / Classe" style="flex: 1;"><input type="text" class="sheet-input dyn-save" data-key="nivel" placeholder="Nível" style="flex: 0.5;"></div><div class="sheet-row" style="margin-top: 15px; gap: 10px;"><div class="sheet-stat-box" style="flex: 1; border-color: #ef4444;"><label style="color:#ef4444;">Pontos de Vida (PV)</label><input type="text" class="dyn-save" data-key="pv" placeholder="Atual / Max" style="color:#ef4444;"></div><div class="sheet-stat-box" style="flex: 1; border-color: #3b82f6;"><label style="color:#3b82f6;">Pontos de Desgaste (PD)</label><input type="text" class="dyn-save" data-key="pd" placeholder="Atual / Max" style="color:#3b82f6;"></div></div><div class="sheet-row" style="margin-top: 15px;"><div class="sheet-col" style="flex: 1;"><div class="sheet-box"><h4>Atributos Base (Tamanho do Dado)</h4><div style="display: flex; gap: 10px; justify-content: space-between; margin-bottom: 15px;"><div class="attr-box"><label>FÍSICO</label><div style="display:flex;align-items:center;">d<input type="text" class="dyn-save" data-key="attr_fisico" value="6" style="width:30px; border:none; background:transparent; color:white; font-size:16px; font-weight:bold; outline:none; text-align:center;"></div></div><div class="attr-box"><label>MENTE</label><div style="display:flex;align-items:center;">d<input type="text" class="dyn-save" data-key="attr_mente" value="6" style="width:30px; border:none; background:transparent; color:white; font-size:16px; font-weight:bold; outline:none; text-align:center;"></div></div><div class="attr-box"><label>EMOÇÃO</label><div style="display:flex;align-items:center;">d<input type="text" class="dyn-save" data-key="attr_emocao" value="6" style="width:30px; border:none; background:transparent; color:white; font-size:16px; font-weight:bold; outline:none; text-align:center;"></div></div></div><h4>Habilidades, Rituais e Inventário</h4><textarea class="sheet-textarea dyn-save" data-key="abilities" style="min-height: 250px;" placeholder="Detalhe suas habilidades aqui..."></textarea></div></div><div class="sheet-col" style="flex: 1.5;"><div class="sheet-box"><h4>Perícias (Dado da Perícia + Dado do Atributo)</h4><div class="skills-grid" style="grid-template-columns: 1fr 1fr;"><div class="skill-item"><span class="rollable" data-ordem2-skill="sk_acrobacia" data-ordem2-attr="attr_fisico" data-name="Acrobacia">Acrobacia (FÍS)</span><div style="display:flex;align-items:center;">d<input type="text" class="dyn-save" data-key="sk_acrobacia" value="4"></div></div><div class="skill-item"><span class="rollable" data-ordem2-skill="sk_atletismo" data-ordem2-attr="attr_fisico" data-name="Atletismo">Atletismo (FÍS)</span><div style="display:flex;align-items:center;">d<input type="text" class="dyn-save" data-key="sk_atletismo" value="4"></div></div><div class="skill-item"><span class="rollable" data-ordem2-skill="sk_crime" data-ordem2-attr="attr_fisico" data-name="Crime">Crime (FÍS)</span><div style="display:flex;align-items:center;">d<input type="text" class="dyn-save" data-key="sk_crime" value="4"></div></div><div class="skill-item"><span class="rollable" data-ordem2-skill="sk_furtividade" data-ordem2-attr="attr_fisico" data-name="Furtividade">Furtividade (FÍS)</span><div style="display:flex;align-items:center;">d<input type="text" class="dyn-save" data-key="sk_furtividade" value="4"></div></div><div class="skill-item"><span class="rollable" data-ordem2-skill="sk_luta" data-ordem2-attr="attr_fisico" data-name="Luta">Luta (FÍS)</span><div style="display:flex;align-items:center;">d<input type="text" class="dyn-save" data-key="sk_luta" value="4"></div></div><div class="skill-item"><span class="rollable" data-ordem2-skill="sk_pontaria" data-ordem2-attr="attr_fisico" data-name="Pontaria">Pontaria (FÍS)</span><div style="display:flex;align-items:center;">d<input type="text" class="dyn-save" data-key="sk_pontaria" value="4"></div></div><div class="skill-item"><span class="rollable" data-ordem2-skill="sk_vigor" data-ordem2-attr="attr_fisico" data-name="Vigor">Vigor (FÍS)</span><div style="display:flex;align-items:center;">d<input type="text" class="dyn-save" data-key="sk_vigor" value="4"></div></div><div class="skill-item"><span class="rollable" data-ordem2-skill="sk_aptidao" data-ordem2-attr="attr_mente" data-name="Aptidão">Aptidão (MEN)</span><div style="display:flex;align-items:center;">d<input type="text" class="dyn-save" data-key="sk_aptidao" value="4"></div></div><div class="skill-item"><span class="rollable" data-ordem2-skill="sk_maquinas" data-ordem2-attr="attr_mente" data-name="Máquinas">Máquinas (MEN)</span><div style="display:flex;align-items:center;">d<input type="text" class="dyn-save" data-key="sk_maquinas" value="4"></div></div><div class="skill-item"><span class="rollable" data-ordem2-skill="sk_medicina" data-ordem2-attr="attr_mente" data-name="Medicina">Medicina (MEN)</span><div style="display:flex;align-items:center;">d<input type="text" class="dyn-save" data-key="sk_medicina" value="4"></div></div><div class="skill-item"><span class="rollable" data-ordem2-skill="sk_ocultismo" data-ordem2-attr="attr_mente" data-name="Ocultismo">Ocultismo (MEN)</span><div style="display:flex;align-items:center;">d<input type="text" class="dyn-save" data-key="sk_ocultismo" value="4"></div></div><div class="skill-item"><span class="rollable" data-ordem2-skill="sk_percepcao" data-ordem2-attr="attr_mente" data-name="Percepção">Percepção (MEN)</span><div style="display:flex;align-items:center;">d<input type="text" class="dyn-save" data-key="sk_percepcao" value="4"></div></div><div class="skill-item"><span class="rollable" data-ordem2-skill="sk_pesquisar" data-ordem2-attr="attr_mente" data-name="Pesquisar">Pesquisar (MEN)</span><div style="display:flex;align-items:center;">d<input type="text" class="dyn-save" data-key="sk_pesquisar" value="4"></div></div><div class="skill-item"><span class="rollable" data-ordem2-skill="sk_sobrevivencia" data-ordem2-attr="attr_mente" data-name="Sobrevivência">Sobreviver (MEN)</span><div style="display:flex;align-items:center;">d<input type="text" class="dyn-save" data-key="sk_sobrevivencia" value="4"></div></div><div class="skill-item"><span class="rollable" data-ordem2-skill="sk_tecnologia" data-ordem2-attr="attr_mente" data-name="Tecnologia">Tecnologia (MEN)</span><div style="display:flex;align-items:center;">d<input type="text" class="dyn-save" data-key="sk_tecnologia" value="4"></div></div><div class="skill-item"><span class="rollable" data-ordem2-skill="sk_disciplina" data-ordem2-attr="attr_emocao" data-name="Disciplina">Disciplina (EMO)</span><div style="display:flex;align-items:center;">d<input type="text" class="dyn-save" data-key="sk_disciplina" value="4"></div></div><div class="skill-item"><span class="rollable" data-ordem2-skill="sk_enganacao" data-ordem2-attr="attr_emocao" data-name="Enganação">Enganação (EMO)</span><div style="display:flex;align-items:center;">d<input type="text" class="dyn-save" data-key="sk_enganacao" value="4"></div></div><div class="skill-item"><span class="rollable" data-ordem2-skill="sk_intimidar" data-ordem2-attr="attr_emocao" data-name="Intimidar">Intimidar (EMO)</span><div style="display:flex;align-items:center;">d<input type="text" class="dyn-save" data-key="sk_intimidar" value="4"></div></div><div class="skill-item"><span class="rollable" data-ordem2-skill="sk_intuicao" data-ordem2-attr="attr_emocao" data-name="Intuição">Intuição (EMO)</span><div style="display:flex;align-items:center;">d<input type="text" class="dyn-save" data-key="sk_intuicao" value="4"></div></div><div class="skill-item"><span class="rollable" data-ordem2-skill="sk_persuasao" data-ordem2-attr="attr_emocao" data-name="Persuasão">Persuasão (EMO)</span><div style="display:flex;align-items:center;">d<input type="text" class="dyn-save" data-key="sk_persuasao" value="4"></div></div></div></div></div>`
};

window.formatSystemName = function(sys) {
    const names = { dnd: "D&D 5e", daggerheart: "Daggerheart", ordem2: "Ordem Paranormal 2", aquelarre: "Aquelarre", assimilacao: "Assimilação RPG", vampire: "Vampire: The Masquerade" };
    return names[sys] || sys.toUpperCase();
}

window.applyCampaignSystem = function(system, broadcast = true) {
    const sysSelect = document.getElementById('rpg-system-select');
    if (sysSelect) sysSelect.value = system;
    const badge = document.getElementById('campaign-system-badge');
    if (badge) badge.textContent = `System: ${window.formatSystemName(system)}`;
    
    updateRosterDropdown(system);
    if (window.updateTabletopRoller) window.updateTabletopRoller(system);
    renderCharacterSheet();
    
    if (broadcast && window.isDM && window.socket && window.socket.readyState === WebSocket.OPEN) {
        window.socket.send(JSON.stringify({ action: 'set_campaign_system', system: system }));
    }
};

function getRoster(system) { return JSON.parse(localStorage.getItem(`conflict_chars_${system}`) || '[]'); }
function saveRoster(system, roster) { localStorage.setItem(`conflict_chars_${system}`, JSON.stringify(roster)); }

function updateRosterDropdown(system) {
    const roster = getRoster(system);
    const select = document.getElementById('character-roster');
    if(!select) return;
    
    select.innerHTML = '';
    if (roster.length === 0) {
        window.activeCharId = Math.random().toString(36).substr(2, 9);
        roster.push({ id: window.activeCharId, name: 'New Character', data: {}, portrait: null });
        saveRoster(system, roster);
    }
    if (!roster.find(c => c.id === window.activeCharId)) window.activeCharId = roster[0].id;

    roster.forEach(char => {
        const opt = document.createElement('option');
        opt.value = char.id; opt.textContent = char.name || 'Unnamed Character';
        select.appendChild(opt);
    });
    select.value = window.activeCharId;
    
    const activeChar = roster.find(c => c.id === window.activeCharId);
    const imgEl = document.getElementById('char-portrait-img');
    if (imgEl && activeChar) {
        imgEl.src = activeChar.portrait || window.defaultAvatar;
    }
}

window.renderPartyList = function() {
    window.viewingRemoteUid = null;
    const container1 = document.getElementById('dynamic-sheet-container');
    
    if (container1 && window.viewingParty) {
        container1.innerHTML = '<h4 style="color:var(--text-muted); margin-bottom:15px;">Party Character Sheets</h4><div class="button-grid" id="vault-party-list" style="display:flex; gap:10px; flex-wrap:wrap;"></div>';
    }

    const grid1 = document.getElementById('vault-party-list');
    const grid2 = document.getElementById('party-list-grid');

    if (Object.keys(window.partySheets).length === 0) {
        if(grid1) grid1.innerHTML = '<p style="color:var(--text-muted); font-size: 13px;">No active character sheets broadcast yet.</p>'; 
        if(grid2) grid2.innerHTML = '<p style="color:var(--text-muted); font-size: 13px;">No active sheets.</p>';
        return;
    }
    
    if(grid1) grid1.innerHTML = '';
    if(grid2) grid2.innerHTML = '';

    for (const [uid, sheetInfo] of Object.entries(window.partySheets)) {
        const btnHtml = `
            <div style="display:flex; align-items:center; gap:10px;">
                <img src="${sheetInfo.portrait || window.defaultAvatar}" style="width:40px; height:40px; border-radius:50%; object-fit:cover;">
                <div>
                    <strong style="font-size:15px; color:var(--accent-main);">${sheetInfo.charName}</strong><br>
                    <span style="font-size:11px; color:var(--text-muted);">${sheetInfo.username} — ${window.formatSystemName(sheetInfo.system)}</span>
                </div>
            </div>`;
            
        if(grid1) {
            const btn1 = document.createElement('button');
            btn1.className = 'secondary-btn kokonut-btn'; btn1.style.textAlign = 'left'; btn1.style.padding = '12px 16px';
            btn1.innerHTML = btnHtml;
            btn1.onclick = () => renderRemoteSheet(uid); 
            grid1.appendChild(btn1);
        }
        if(grid2) {
            const btn2 = document.createElement('div');
            btn2.className = 'panel'; btn2.style.background = 'rgba(0,0,0,0.4)'; btn2.style.padding = '10px'; btn2.style.cursor = 'pointer';
            btn2.innerHTML = btnHtml;
            btn2.onclick = () => { 
                document.querySelector('[data-tab="sheets"]')?.click(); 
                if (!window.viewingParty) {
                    window.viewingParty = true;
                    const vpb = document.getElementById('view-party-btn');
                    if(vpb) vpb.innerText = "👤 My Character"; 
                    [document.getElementById('rpg-system-select'), document.getElementById('character-roster'), document.getElementById('new-char-btn'), document.querySelector('.sheet-divider')].forEach(el => { if (el) el.style.display = 'none'; }); 
                    const portrait = document.getElementById('char-portrait-img'); if(portrait) portrait.style.display = 'none';
                    const spawnBtn = document.getElementById('spawn-char-token-btn'); if(spawnBtn) spawnBtn.style.display = 'none';
                    window.renderPartyList(); 
                }
                renderRemoteSheet(uid); 
            };
            grid2.appendChild(btn2);
        }
    }
};

function renderRemoteSheet(uid) {
    window.viewingRemoteUid = uid;
    const sheetInfo = window.partySheets[uid];
    if (!sheetInfo) return;

    const container = document.getElementById('dynamic-sheet-container');
    container.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 20px;"><button class="outline-btn kokonut-btn" onclick="window.renderPartyList()">⬅ Back to Party</button><span style="color:var(--text-muted); font-size:12px;">Viewing <strong>${sheetInfo.username}</strong>'s Sheet (${window.formatSystemName(sheetInfo.system)})</span></div>` + (window.sheetBlueprints[sheetInfo.system] || '<p>System not found.</p>');

    container.querySelectorAll('.dyn-save').forEach(input => {
        const key = input.getAttribute('data-key');
        if (input.type === 'checkbox') input.checked = sheetInfo.data[key] === true;
        else if (sheetInfo.data[key]) input.value = sheetInfo.data[key];
        input.style.pointerEvents = 'none'; input.readOnly = true; 
    });
}

function renderCharacterSheet() {
    if (window.viewingParty) return;
    const system = document.getElementById('rpg-system-select')?.value || 'dnd';
    const container = document.getElementById('dynamic-sheet-container');
    if (!container) return;
    
    container.innerHTML = window.sheetBlueprints[system] || `<p>System not found.</p>`;
    const roster = getRoster(system);
    const activeChar = roster.find(c => c.id === window.activeCharId) || roster[0];
    const parsedData = activeChar ? (activeChar.data || {}) : {};
    
    container.querySelectorAll('.dyn-save').forEach(input => {
        const key = input.getAttribute('data-key');
        if (input.type === 'checkbox') input.checked = parsedData[key] === true;
        else if (parsedData[key]) input.value = parsedData[key];
    });

    window.saveCharacterSheet(system);
    if (window.updateTabletopRoller) window.updateTabletopRoller(system);
}

window.saveCharacterSheet = function(system) {
    if (window.viewingParty) return; 
    const container = document.getElementById('dynamic-sheet-container');
    if(!container) return;

    const data = {};
    let charName = "Unnamed Character";
    
    container.querySelectorAll('.dyn-save').forEach(input => {
        const key = input.getAttribute('data-key');
        data[key] = input.type === 'checkbox' ? input.checked : input.value;
        if (key === 'name' && input.value.trim()) charName = input.value.trim();
    });
    
    const roster = getRoster(system);
    const charIndex = roster.findIndex(c => c.id === window.activeCharId);
    let portraitUrl = null;
    
    if (charIndex > -1) {
        roster[charIndex].data = data; roster[charIndex].name = charName;
        portraitUrl = roster[charIndex].portrait || null;
        saveRoster(system, roster);
        const opt = document.querySelector(`#character-roster option[value="${window.activeCharId}"]`);
        if (opt) opt.textContent = charName;
    }
    
    if (window.socket && window.socket.readyState === WebSocket.OPEN) {
        window.socket.send(JSON.stringify({ action: 'sheet_update', userId: window.myId, username: document.getElementById('display-username').textContent, system: system, charName: charName, data: data, portrait: portraitUrl }));
    }

    const statusText = document.getElementById('sheet-save-status');
    if(statusText) {
        statusText.style.opacity = 1; clearTimeout(window.saveTimeout);
        window.saveTimeout = setTimeout(() => { statusText.style.opacity = 0; }, 2000);
    }
    
    if (window.updateTabletopRoller) window.updateTabletopRoller(system);
};

window.updateTabletopRoller = function(system) {
    let container = document.getElementById('dynamic-dice-controls');
    if (!container) {
        const toolbar = document.querySelector('.kokonut-toolbar > div');
        if (toolbar) {
            container = document.createElement('div');
            container.id = 'dynamic-dice-controls';
            container.style = 'display: flex; gap: 8px; align-items: center; margin-left: 10px;';
            toolbar.appendChild(container);
        } else return;
    }

    let statOptions = '';
    const rollables = document.querySelectorAll('#dynamic-sheet-container .rollable');
    const addedStats = new Set();

    if (system === 'ordem2') {
        rollables.forEach(el => {
            const statName = el.getAttribute('data-name');
            if (!statName) return; 
            const cleanLabel = statName.replace(' Check', '').replace(' Roll', '');
            
            const skillKey = el.getAttribute('data-ordem2-skill');
            const attrKey = el.getAttribute('data-ordem2-attr');
            
            if (skillKey && attrKey && !addedStats.has(cleanLabel)) {
                const skillDie = parseInt(document.querySelector(`input[data-key="${skillKey}"]`)?.value) || 4;
                const attrDie = parseInt(document.querySelector(`input[data-key="${attrKey}"]`)?.value) || 4;
                statOptions += `<option value="${skillDie}|${attrDie}" data-statname="${cleanLabel}">${cleanLabel} (d${skillDie}+d${attrDie})</option>`;
                addedStats.add(cleanLabel);
            }
        });

        container.innerHTML = `
            <div style="display:flex; align-items:center; background: rgba(0,0,0,0.6); border: 1px solid var(--accent-main); border-radius: 8px; padding: 2px 6px; box-shadow: 0 2px 10px rgba(0,0,0,0.5); gap: 5px;">
                <span style="color: var(--text-muted); font-size: 13px; font-weight: bold;">d</span>
                <select id="ordem-dice-1" class="config-select kokonut-select" style="height: 26px; padding: 0 2px; border: none !important; background: transparent !important; font-size: 13px; font-weight: bold; color: var(--accent-main) !important; cursor: pointer;">
                    <option value="4">4</option> <option value="6">6</option> <option value="8">8</option> <option value="10">10</option> <option value="12">12</option> <option value="20" selected>20</option>
                </select>
                <span style="color: var(--text-muted); font-size: 13px; font-weight: bold;">+ d</span>
                <select id="ordem-dice-2" class="config-select kokonut-select" style="height: 26px; padding: 0 2px; border: none !important; background: transparent !important; font-size: 13px; font-weight: bold; color: var(--accent-main) !important; cursor: pointer;">
                    <option value="4">4</option> <option value="6">6</option> <option value="8">8</option> <option value="10">10</option> <option value="12">12</option> <option value="20" selected>20</option>
                </select>
                
                <div style="width: 1px; height: 16px; background: var(--border-color); margin: 0 4px;"></div>
                
                <input type="text" id="manual-dice-name" class="kokonut-input" placeholder="Roll name..." value="Ação Ordem" style="width: 100px; height: 26px; padding: 0 6px; font-size: 12px; border: none !important; background: transparent !important; color: white;">
                
                <select id="manual-dice-stat-pick" class="config-select kokonut-select" style="width: 24px; height: 26px; padding: 0; border: none !important; background: transparent !important; font-size: 12px; color: var(--text-main) !important; cursor: pointer; text-align: center;" title="Quick Pick from Sheet" onchange="
                    if(this.value !== '') {
                        const parts = this.value.split('|');
                        document.getElementById('ordem-dice-1').value = parts[0];
                        document.getElementById('ordem-dice-2').value = parts[1];
                        document.getElementById('manual-dice-name').value = this.options[this.selectedIndex].getAttribute('data-statname');
                    }
                    this.value = '';
                ">
                    <option value="" disabled selected>▼</option>
                    ${statOptions}
                </select>

                <span style="color: var(--text-muted); font-size: 13px; font-weight: bold;">+</span>
                <input type="number" id="manual-dice-mod" class="kokonut-input" value="0" style="width: 35px; height: 26px; padding: 0 2px; font-size: 13px; text-align: center; border: none !important; background: transparent !important; color: white;" title="Bônus Fixo">
                
                <button id="execute-ordem-roll" class="primary-btn glow-btn kokonut-btn" style="padding: 4px 10px; font-size: 11px; border-radius: 6px; font-weight: bold; margin-left: 4px;">ROLL</button>
            </div>
        `;
    } else {
        let defaultCount = 1; let defaultSides = 20;
        if (system === 'daggerheart') { defaultCount = 2; defaultSides = 12; }
        if (system === 'aquelarre') { defaultSides = 100; }
        if (system === 'vampire') { defaultSides = 10; }

        rollables.forEach(el => {
            const statName = el.getAttribute('data-name');
            if (!statName) return; 
            const cleanLabel = statName.replace(' Check', '').replace(' Roll', '');
            
            const modTarget = el.getAttribute('data-mod-target');
            const isAttr = el.getAttribute('data-is-attr') === 'true';
            
            let modVal = 0;
            if (modTarget) {
                const inputEl = document.querySelector(`input[data-key="${modTarget}"]`);
                if (inputEl) {
                    let rawVal = inputEl.value;
                    if (isAttr && !rawVal.includes('+') && !rawVal.includes('-')) {
                        const score = parseInt(rawVal) || 10;
                        modVal = Math.floor((score - 10) / 2); 
                    } else { 
                        modVal = parseInt(rawVal.replace('+', '')) || 0; 
                    }
                }
            }
            if (!addedStats.has(cleanLabel)) {
                statOptions += `<option value="${modVal}" data-statname="${cleanLabel}">${cleanLabel} (${modVal >= 0 ? '+'+modVal : modVal})</option>`;
                addedStats.add(cleanLabel);
            }
        });

        container.innerHTML = `
            <div style="display:flex; align-items:center; background: rgba(0,0,0,0.6); border: 1px solid var(--accent-main); border-radius: 8px; padding: 2px 6px; box-shadow: 0 2px 10px rgba(0,0,0,0.5); gap: 5px;">
                <input type="number" id="manual-dice-count" class="kokonut-input" value="${defaultCount}" min="1" max="50" style="width: 35px; height: 26px; padding: 0 2px; font-size: 13px; text-align: center; border: none !important; background: transparent !important; color: white;" title="Amount">
                <span style="color: var(--text-muted); font-size: 13px; font-weight: bold;">d</span>
                <select id="manual-dice-type" class="config-select kokonut-select" style="height: 26px; padding: 0 2px; border: none !important; background: transparent !important; font-size: 13px; font-weight: bold; color: var(--accent-main) !important; cursor: pointer;">
                    <option value="4" ${defaultSides===4?'selected':''}>4</option> <option value="6" ${defaultSides===6?'selected':''}>6</option> <option value="8" ${defaultSides===8?'selected':''}>8</option> <option value="10" ${defaultSides===10?'selected':''}>10</option> <option value="12" ${defaultSides===12?'selected':''}>12</option> <option value="20" ${defaultSides===20?'selected':''}>20</option> <option value="100" ${defaultSides===100?'selected':''}>100</option>
                </select>
                <div style="width: 1px; height: 16px; background: var(--border-color); margin: 0 4px;"></div>
                <input type="text" id="manual-dice-name" class="kokonut-input" placeholder="Roll name..." value="Custom Roll" style="width: 100px; height: 26px; padding: 0 6px; font-size: 12px; border: none !important; background: transparent !important; color: white;">
                <select id="manual-dice-stat-pick" class="config-select kokonut-select" style="width: 24px; height: 26px; padding: 0; border: none !important; background: transparent !important; font-size: 12px; color: var(--text-main) !important; cursor: pointer; text-align: center;" title="Quick Pick from Sheet" onchange="
                    if(this.value !== '') {
                        document.getElementById('manual-dice-name').value = this.options[this.selectedIndex].getAttribute('data-statname');
                        document.getElementById('manual-dice-mod').value = this.value;
                    }
                    this.value = '';
                ">
                    <option value="" disabled selected>▼</option>
                    ${statOptions}
                </select>
                <span style="color: var(--text-muted); font-size: 13px; font-weight: bold;">+</span>
                <input type="number" id="manual-dice-mod" class="kokonut-input" value="0" style="width: 35px; height: 26px; padding: 0 2px; font-size: 13px; text-align: center; border: none !important; background: transparent !important; color: white;" title="Modifier">
                <button id="execute-manual-roll" class="primary-btn glow-btn kokonut-btn" style="padding: 4px 10px; font-size: 11px; border-radius: 6px; font-weight: bold; margin-left: 4px;">ROLL</button>
            </div>
        `;
    }
};

window.animateDiceRoll2D = function(results, diceTypeArray, customClasses) {
    const layer = document.getElementById('dice-layer');
    if (!layer) return;
    
    results.forEach((res, i) => {
        let currentDiceType = Array.isArray(diceTypeArray) ? diceTypeArray[i] : diceTypeArray;
        if (!currentDiceType || currentDiceType === 'd') currentDiceType = 'd20';

        const diceEl = document.createElement('div');
        let cClass = '';
        if (Array.isArray(customClasses)) cClass = customClasses[i] || '';
        else if (customClasses) cClass = customClasses;

        diceEl.className = `die-2d shape-${currentDiceType} ${cClass}`;
        
        const tx = (Math.random() * 400 - 200) + 'px';
        const ty = (Math.random() * 400 - 200) + 'px';
        diceEl.style.setProperty('--tx', tx);
        diceEl.style.setProperty('--ty', ty);
        
        diceEl.innerHTML = `<span>${res}</span>`;
        layer.appendChild(diceEl);
        
        setTimeout(() => {
            diceEl.style.opacity = '0';
            setTimeout(() => diceEl.remove(), 500);
        }, 3500);
    });
};

function rollDice(count, sides, modVal, statName, targetEl) {
    const currentName = document.getElementById('display-username')?.textContent || 'User';
    const charNameInput = document.querySelector('input[data-key="name"]');
    const charName = (charNameInput && charNameInput.value && !window.viewingParty) ? charNameInput.value : currentName;

    let results = [];
    let message = "";
    let customClasses = null;

    if (count === 2 && sides === 12 && document.getElementById('rpg-system-select')?.value === 'daggerheart') {
        const hope = Math.floor(Math.random() * 12) + 1;
        const fear = Math.floor(Math.random() * 12) + 1;
        results = [hope, fear];
        customClasses = ['dh-hope', 'dh-fear']; 
        
        const total = hope + fear + modVal;
        const modString = modVal !== 0 ? (modVal > 0 ? `+${modVal}` : `${modVal}`) : '';
        
        let outcome = "";
        if (hope === fear) outcome = "🌟 <strong style='color:#fbbf24'>CRITICAL SUCCESS!</strong>";
        else if (hope > fear) outcome = "🔵 <strong style='color:#3b82f6'>With HOPE</strong>";
        else outcome = "🟡 <strong style='color:#eab308'>With FEAR</strong>";

        message = `🎲 **${charName}** rolled **${statName}**: <br>[Hope: ${hope}] + [Fear: ${fear}] ${modString} = <span style="font-size:18px; color:var(--accent-main); font-weight:bold;">${total}</span> <br>${outcome}`;
    } 
    else {
        const randomBuffer = new Uint32Array(count);
        window.crypto.getRandomValues(randomBuffer);
        for (let i = 0; i < count; i++) results.push(Math.floor((randomBuffer[i] / (0xffffffff + 1)) * sides) + 1);

        const sum = results.reduce((a, b) => a + b, 0);
        const total = sum + modVal;
        const modString = modVal !== 0 ? (modVal > 0 ? `+${modVal}` : `${modVal}`) : '';

        if (sides === 100) {
            message = `🎲 **${charName}** rolled **${statName}**: **${results[0]}** (Target: ${modVal})`;
        } else if (sides === 10) {
            const successes = results.filter(r => r >= 6).length;
            const crits = results.filter(r => r === 10).length;
            const finalSucc = successes + (Math.floor(crits / 2) * 2);
            message = `🎲 **${charName}** rolled **${statName}**: [${results.join(', ')}] = **${finalSucc} Successes**`;
        } else {
            message = `🎲 **${charName}** rolled **${statName}**: [${results.join(', ')}] ${modString} = **${total}**`;
        }
    }

    if (window.socket && window.socket.readyState === WebSocket.OPEN) {
        window.socket.send(JSON.stringify({ action: 'chat_message', userId: window.myId, username: currentName, text: message }));
        window.socket.send(JSON.stringify({ action: 'dice_roll', userId: window.myId, results: results, type: 'd'+sides, customClasses: customClasses }));
    }
    
    if (window.addChatLine) window.addChatLine(currentName, message); 
    if (window.animateDiceRoll2D) window.animateDiceRoll2D(results, 'd'+sides, customClasses);
    
    if (results.includes(sides) && window.triggerFireworks) window.triggerFireworks();
    if (typeof anime !== 'undefined' && targetEl) anime({ targets: targetEl, scale: [1.2, 1], duration: 400, easing: 'easeOutElastic(1, .5)' });
}

// Global click & change listeners
if (window.rpgChangeHandler) document.removeEventListener('change', window.rpgChangeHandler);
window.rpgChangeHandler = (e) => { 
    if (e.target.id === 'rpg-system-select') {
        window.applyCampaignSystem(e.target.value, window.isDM);
    }
    if (e.target.id === 'character-roster') {
        window.activeCharId = e.target.value; 
        updateRosterDropdown(document.getElementById('rpg-system-select').value); 
        renderCharacterSheet();
    }
};
document.addEventListener('change', window.rpgChangeHandler);

if (window.rpgClickHandler) document.removeEventListener('click', window.rpgClickHandler);
window.rpgClickHandler = (e) => {
    if (e.target.closest('#new-char-btn')) {
        const system = document.getElementById('rpg-system-select').value;
        const roster = getRoster(system);
        window.activeCharId = Math.random().toString(36).substr(2, 9);
        roster.push({ id: window.activeCharId, name: 'New Character', data: {}, portrait: null });
        saveRoster(system, roster); 
        updateRosterDropdown(system); 
        renderCharacterSheet();
    }
    if (e.target.closest('#view-party-btn')) {
        window.viewingParty = !window.viewingParty;
        const btn = document.getElementById('view-party-btn');
        const controls = [document.getElementById('rpg-system-select'), document.getElementById('character-roster'), document.getElementById('new-char-btn'), document.querySelector('.sheet-divider')];
        
        if (window.viewingParty) {
            if(btn) btn.innerText = "👤 My Character"; 
            controls.forEach(el => { if (el) el.style.display = 'none'; }); 
            const portrait = document.getElementById('char-portrait-img'); if(portrait) portrait.style.display = 'none';
            const spawnBtn = document.getElementById('spawn-char-token-btn'); if(spawnBtn) spawnBtn.style.display = 'none';
            window.renderPartyList(); 
        } else {
            if(btn) btn.innerText = "👁️ Party Sheets"; 
            controls.forEach(el => { if (el) el.style.display = 'block'; }); 
            const portrait = document.getElementById('char-portrait-img'); if(portrait) portrait.style.display = 'block';
            const spawnBtn = document.getElementById('spawn-char-token-btn'); if(spawnBtn) spawnBtn.style.display = 'block';
            renderCharacterSheet(); 
        }
    }
    if (e.target.closest('#tab-dm-btn')) {
        if (window.renderPartyList) window.renderPartyList();
        renderNpcs();
    }
    if (e.target.closest('#add-npc-btn')) {
        window.npcRoster.push({ id: Math.random().toString(36).substr(2,9), name: 'New Goblin', hp: 7, ac: 15, portrait: null });
        saveNpcs(); renderNpcs();
    }
    if (e.target.closest('#spawn-char-token-btn')) {
        const sys = document.getElementById('rpg-system-select').value;
        const roster = getRoster(sys);
        const activeChar = roster.find(c => c.id === window.activeCharId);
        if (!activeChar || !activeChar.portrait) return alert("Please click your portrait above and upload an image first!");
        const asset = { id: window.myId + '-' + window.activeCharId, name: activeChar.name, src: activeChar.portrait, type: 'token', ownerId: window.myId };
        
        document.querySelector('[data-tab="rpg"]')?.click();
        setTimeout(() => { if (window.placeTokenOnMap) window.placeTokenOnMap(asset, true); }, 50);
    }

    // --- ORDEM 2 DICE POOL LOGIC ---
    const ordemManualBtn = e.target.closest('#execute-ordem-roll');
    if (ordemManualBtn) {
        const d1 = parseInt(document.getElementById('ordem-dice-1').value) || 20;
        const d2 = parseInt(document.getElementById('ordem-dice-2').value) || 20;
        const modVal = parseInt(document.getElementById('manual-dice-mod').value) || 0;
        const nameInput = document.getElementById('manual-dice-name');
        const statName = nameInput && nameInput.value.trim() ? nameInput.value.trim() : "Custom Roll";

        const r1 = Math.floor(Math.random() * d1) + 1;
        const r2 = Math.floor(Math.random() * d2) + 1;
        const total = r1 + r2 + modVal;

        const charNameInput = document.querySelector('input[data-key="name"]');
        const charName = (charNameInput && charNameInput.value && !window.viewingParty) ? charNameInput.value : (document.getElementById('display-username')?.textContent || 'User');

        const modString = modVal !== 0 ? (modVal > 0 ? `+${modVal}` : `${modVal}`) : '';
        const message = `🎲 **${charName}** rolou **${statName}**: <br>[d${d1}: ${r1}] + [d${d2}: ${r2}] ${modString} = <span style="font-size:18px; color:var(--accent-main); font-weight:bold;">${total}</span>`;
        
        if (window.socket && window.socket.readyState === WebSocket.OPEN) {
            window.socket.send(JSON.stringify({ action: 'chat_message', userId: window.myId, username: charName, text: message }));
            window.socket.send(JSON.stringify({ action: 'dice_roll', userId: window.myId, results: [r1, r2], type: ['d'+d1, 'd'+d2] }));
        }
        
        if (window.addChatLine) window.addChatLine(charName, message); 
        if (window.animateDiceRoll2D) window.animateDiceRoll2D([r1, r2], ['d'+d1, 'd'+d2]);
        if (typeof anime !== 'undefined') anime({ targets: ordemManualBtn, scale: [1.2, 1], duration: 400, easing: 'easeOutElastic(1, .5)' });
        return;
    }

    const ordemTarget = e.target.closest('.rollable[data-ordem2-skill]');
    if (ordemTarget && !window.viewingParty && document.getElementById('dynamic-sheet-container')?.contains(ordemTarget)) {
        const statName = ordemTarget.getAttribute('data-name');
        const skillKey = ordemTarget.getAttribute('data-ordem2-skill');
        const attrKey = ordemTarget.getAttribute('data-ordem2-attr');
        
        const skillDie = parseInt(document.querySelector(`input[data-key="${skillKey}"]`)?.value) || 4;
        const attrDie = parseInt(document.querySelector(`input[data-key="${attrKey}"]`)?.value) || 4;
        
        const r1 = Math.floor(Math.random() * skillDie) + 1;
        const r2 = Math.floor(Math.random() * attrDie) + 1;
        const total = r1 + r2;
        
        const charNameInput = document.querySelector('input[data-key="name"]');
        const charName = (charNameInput && charNameInput.value && !window.viewingParty) ? charNameInput.value : (document.getElementById('display-username')?.textContent || 'User');

        const attrLabel = attrKey === 'attr_fisico' ? 'Físico' : (attrKey === 'attr_mente' ? 'Mente' : 'Emoção');
        
        const message = `🎲 **${charName}** rolou **${statName}**: <br>[d${skillDie}: ${r1}] + [d${attrDie} ${attrLabel}: ${r2}] = <span style="font-size:18px; color:var(--accent-main); font-weight:bold;">${total}</span>`;
        
        if (window.socket && window.socket.readyState === WebSocket.OPEN) {
            window.socket.send(JSON.stringify({ action: 'chat_message', userId: window.myId, username: charName, text: message }));
            window.socket.send(JSON.stringify({ action: 'dice_roll', userId: window.myId, results: [r1, r2], type: ['d'+skillDie, 'd'+attrDie] }));
        }
        
        if (window.addChatLine) window.addChatLine(charName, message); 
        if (window.animateDiceRoll2D) window.animateDiceRoll2D([r1, r2], ['d'+skillDie, 'd'+attrDie]);
        if (typeof anime !== 'undefined') anime({ targets: ordemTarget, scale: [1.3, 1], duration: 400, easing: 'easeOutElastic(1, .5)' });
        return;
    }

    const manualBtn = e.target.closest('#execute-manual-roll');
    if (manualBtn) {
        const count = parseInt(document.getElementById('manual-dice-count').value) || 1;
        const sides = parseInt(document.getElementById('manual-dice-type').value) || 20;
        const modVal = parseInt(document.getElementById('manual-dice-mod').value) || 0;
        const nameInput = document.getElementById('manual-dice-name');
        const statName = nameInput && nameInput.value.trim() ? nameInput.value.trim() : "Custom Roll";

        rollDice(count, sides, modVal, statName, manualBtn);
        return;
    }

    const target = e.target.closest('.rollable');
    if (target && !window.viewingParty && document.getElementById('dynamic-sheet-container')?.contains(target)) {
        const statName = target.getAttribute('data-name');
        const modTarget = target.getAttribute('data-mod-target');
        const isAttr = target.getAttribute('data-is-attr') === 'true';

        let modVal = 0;
        if (modTarget) {
            const inputEl = document.querySelector(`input[data-key="${modTarget}"]`);
            if (inputEl) {
                let rawVal = inputEl.value;
                if (isAttr && !rawVal.includes('+') && !rawVal.includes('-')) {
                    const score = parseInt(rawVal) || 10;
                    modVal = Math.floor((score - 10) / 2); 
                } else { modVal = parseInt(rawVal.replace('+', '')) || 0; }
            }
        }

        const diceType = target.getAttribute('data-dice') || '1d20';
        const [countStr, type] = diceType.split('d');
        const count = parseInt(countStr) || 1; 
        const sides = parseInt(type) || 20;

        rollDice(count, sides, modVal, statName, target);
    }
};
document.addEventListener('click', window.rpgClickHandler);

// --- CROPPER ENGINE ---
window.cropMode = 'avatar';
window.activeNpcCropId = null;
window.rawUploadedImage = null;
window.cropScale = 1; window.imgX = 0; window.imgY = 0; window.isDraggingImg = false; window.startX = 0; window.startY = 0;

if (window.cropperClickHandler) document.removeEventListener('click', window.cropperClickHandler);
window.cropperClickHandler = (e) => {
    if (e.target.closest('#change-avatar-btn')) { window.cropMode = 'avatar'; document.getElementById('avatar-upload')?.click(); }
    if (e.target.closest('#char-portrait-img')) { window.cropMode = 'character'; document.getElementById('avatar-upload')?.click(); }
    if (e.target.closest('#cancel-crop-btn')) { 
        const ov = document.getElementById('crop-modal-overlay'); if (ov) ov.style.display = 'none'; 
        const md = document.getElementById('crop-modal'); if (md) md.style.display = 'none'; 
    }
    if (e.target.closest('#save-crop-btn')) {
        const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 200; const ctx = canvas.getContext('2d');
        const img = new Image(); img.src = window.rawUploadedImage;
        img.onload = () => {
            ctx.clearRect(0, 0, 200, 200); ctx.save(); ctx.beginPath(); ctx.arc(100, 100, 100, 0, Math.PI * 2); ctx.clip(); 
            const targetImg = document.getElementById('crop-image-target');
            const w = targetImg.naturalWidth; const h = targetImg.naturalHeight;
            const drawX = 100 - (w * window.cropScale) / 2 + (window.imgX - (200 - w) / 2);
            const drawY = 100 - (h * window.cropScale) / 2 + (window.imgY - (200 - h) / 2);

            ctx.drawImage(img, drawX, drawY, w * window.cropScale, h * window.cropScale); ctx.restore();
            const croppedDataUrl = canvas.toDataURL('image/png');
            
            if (window.cropMode === 'avatar') {
                const prev = document.getElementById('config-avatar-preview'); if(prev) prev.src = croppedDataUrl; 
                const ua = document.getElementById('user-avatar'); if(ua) ua.src = croppedDataUrl;
                localStorage.setItem('appAvatar', croppedDataUrl);
            } else if (window.cropMode === 'character') {
                const cp = document.getElementById('char-portrait-img'); if(cp) cp.src = croppedDataUrl;
                const system = document.getElementById('rpg-system-select').value;
                const roster = getRoster(system);
                const charIndex = roster.findIndex(c => c.id === window.activeCharId);
                if (charIndex > -1) { roster[charIndex].portrait = croppedDataUrl; saveRoster(system, roster); window.saveCharacterSheet(system); }
            } else if (window.cropMode === 'npc') {
                const npc = window.npcRoster.find(n => n.id === window.activeNpcCropId);
                if (npc) { npc.portrait = croppedDataUrl; saveNpcs(); renderNpcs(); }
            }

            const ov = document.getElementById('crop-modal-overlay'); if (ov) ov.style.display = 'none'; 
            const md = document.getElementById('crop-modal'); if (md) md.style.display = 'none'; 
        };
    }
};
document.addEventListener('click', window.cropperClickHandler);

if (window.cropperChangeHandler) document.removeEventListener('change', window.cropperChangeHandler);
window.cropperChangeHandler = (event) => {
    if (event.target.id === 'avatar-upload') {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            window.rawUploadedImage = e.target.result;
            const targetImg = document.getElementById('crop-image-target');
            if (targetImg) {
                targetImg.src = window.rawUploadedImage;
                targetImg.onload = () => {
                    const minDimension = Math.min(targetImg.naturalWidth, targetImg.naturalHeight);
                    window.cropScale = 200 / minDimension; 
                    const zoomSlider = document.getElementById('crop-zoom-slider');
                    if (zoomSlider) {
                        zoomSlider.min = Math.min(0.01, window.cropScale / 3);
                        zoomSlider.max = Math.max(5, window.cropScale * 5);
                        zoomSlider.value = window.cropScale;
                    }
                    window.imgX = (200 - targetImg.naturalWidth) / 2; 
                    window.imgY = (200 - targetImg.naturalHeight) / 2;
                    updateImageTransform();
                    
                    const ov = document.getElementById('crop-modal-overlay'); if (ov) ov.style.display = 'block'; 
                    const md = document.getElementById('crop-modal'); if (md) md.style.display = 'flex'; 
                };
            }
        };
        reader.readAsDataURL(file);
    }
};
document.addEventListener('change', window.cropperChangeHandler);

if (window.cropperMousedownHandler) document.removeEventListener('mousedown', window.cropperMousedownHandler);
window.cropperMousedownHandler = (e) => { 
    const viewport = document.getElementById('crop-viewport');
    if (viewport && viewport.contains(e.target)) {
        window.isDraggingImg = true; window.startX = e.clientX - window.imgX; window.startY = e.clientY - window.imgY; viewport.style.cursor = 'grabbing'; 
    }
};
document.addEventListener('mousedown', window.cropperMousedownHandler);

if (window.cropperMousemoveHandler) document.removeEventListener('mousemove', window.cropperMousemoveHandler);
window.cropperMousemoveHandler = (e) => { 
    if (!window.isDraggingImg) return; window.imgX = e.clientX - window.startX; window.imgY = e.clientY - window.startY; updateImageTransform(); 
};
document.addEventListener('mousemove', window.cropperMousemoveHandler);

if (window.cropperWheelHandler) document.removeEventListener('wheel', window.cropperWheelHandler);
window.cropperWheelHandler = (e) => {
    const cropModal = document.getElementById('crop-modal');
    if (cropModal && cropModal.style.display !== 'none' && cropModal.contains(e.target)) {
        e.preventDefault();
        const zoomStep = 0.05;
        if (e.deltaY < 0) window.cropScale = Math.min(5.0, window.cropScale + zoomStep);
        else window.cropScale = Math.max(0.05, window.cropScale - zoomStep);
        
        const slider = document.getElementById('crop-zoom-slider');
        if (slider) slider.value = window.cropScale;
        if (typeof updateImageTransform === 'function') updateImageTransform();
    }
};
document.addEventListener('wheel', window.cropperWheelHandler, { passive: false });

if (window.cropperMouseupHandler) document.removeEventListener('mouseup', window.cropperMouseupHandler);
window.cropperMouseupHandler = () => { window.isDraggingImg = false; const v = document.getElementById('crop-viewport'); if(v) v.style.cursor = 'grab'; };
document.addEventListener('mouseup', window.cropperMouseupHandler);

if (window.cropperInputHandler) document.removeEventListener('input', window.cropperInputHandler);
window.cropperInputHandler = (e) => {
    if (e.target.id === 'crop-zoom-slider') { window.cropScale = parseFloat(e.target.value); updateImageTransform(); }
};
document.addEventListener('input', window.cropperInputHandler);

function updateImageTransform() { 
    const targetImg = document.getElementById('crop-image-target');
    if (targetImg) targetImg.style.transform = `translate(${window.imgX}px, ${window.imgY}px) scale(${window.cropScale})`; 
}

// -- NPC MANAGER --
function saveNpcs() { localStorage.setItem('conflict_npcs', JSON.stringify(window.npcRoster)); }

window.triggerNpcCrop = function(npcId) {
    window.cropMode = 'npc';
    window.activeNpcCropId = npcId;
    document.getElementById('avatar-upload')?.click();
};

window.deleteNpc = function(id) {
    window.npcRoster = window.npcRoster.filter(n => n.id !== id);
    saveNpcs(); renderNpcs();
};

window.spawnNpc = function(id) {
    const npc = window.npcRoster.find(n => n.id === id);
    if (!npc) return;
    const asset = { id: window.myId + '-' + Math.random().toString(36).substr(2,6), name: npc.name, src: npc.portrait || window.defaultAvatar, type: 'token', ownerId: window.myId };
    
    document.querySelector('[data-tab="rpg"]')?.click();
    setTimeout(() => { if (window.placeTokenOnMap) window.placeTokenOnMap(asset, true); }, 50);
};

function renderNpcs() {
    const grid = document.getElementById('npc-list-grid');
    if(!grid) return;
    grid.innerHTML = '';
    window.npcRoster.forEach(npc => {
        const div = document.createElement('div');
        div.className = 'panel';
        div.style = 'background:rgba(0,0,0,0.4); padding:10px; border-radius:8px; border:1px solid var(--border-color); display:flex; gap:10px; align-items:center;';
        div.innerHTML = `
            <img src="${npc.portrait || window.defaultAvatar}" style="width:40px;height:40px;border-radius:50%; cursor:pointer; object-fit:cover; border:1px solid var(--accent-main);" onclick="window.triggerNpcCrop('${npc.id}')" title="Click to upload portrait">
            <div style="flex-grow:1; display:flex; flex-direction:column; gap:4px;">
                <input type="text" class="kokonut-input npc-input" data-id="${npc.id}" data-field="name" value="${npc.name}" placeholder="NPC Name" style="padding:4px 8px; font-size:12px; width:100%; box-sizing:border-box;">
                <div style="display:flex; gap:10px; font-size:11px; color:var(--text-muted); align-items:center;">
                    HP: <input type="number" class="kokonut-input npc-input" data-id="${npc.id}" data-field="hp" value="${npc.hp}" style="padding:4px; font-size:11px; width:50px;">
                    AC: <input type="number" class="kokonut-input npc-input" data-id="${npc.id}" data-field="ac" value="${npc.ac}" style="padding:4px; font-size:11px; width:50px;">
                </div>
            </div>
            <button class="primary-btn glow-btn kokonut-btn" onclick="window.spawnNpc('${npc.id}')" style="padding:6px 12px; font-size:11px;">Spawn</button>
            <button class="outline-btn kokonut-btn" onclick="window.deleteNpc('${npc.id}')" style="padding:6px; color:var(--accent-alert); border-color:var(--accent-alert);">✕</button>
        `;
        grid.appendChild(div);
    });
    
    document.querySelectorAll('.npc-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const id = e.target.getAttribute('data-id');
            const field = e.target.getAttribute('data-field');
            const npc = window.npcRoster.find(n => n.id === id);
            if (npc) { npc[field] = e.target.value; saveNpcs(); }
        });
    });
}

function initRPG() {
    const sysSelect = document.getElementById('rpg-system-select');
    if (sysSelect) {
        if (!sysSelect.querySelector('option[value="ordem2"]')) {
            const opt = document.createElement('option'); opt.value = 'ordem2'; opt.textContent = 'Ordem Paranormal 2'; sysSelect.appendChild(opt);
        }
        sysSelect.disabled = false;
        sysSelect.title = "Select your system";
    }
    const initialSys = sysSelect?.value || 'dnd';
    updateRosterDropdown(initialSys);
    if (window.updateTabletopRoller) window.updateTabletopRoller(initialSys);
    renderCharacterSheet();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRPG);
} else {
    initRPG();
}