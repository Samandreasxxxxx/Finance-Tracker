// Personal Finance Tracker Logic - Sam's Networth (Connected to Neon DB)

const GOAL_START = -500000; // -5 Lakhs INR
const GOAL_TARGET = 1000000; // +10 Lakhs INR
const TARGET_DATE = new Date('2026-12-31');

// Local State Copy (synced with database)
let state = {
  bankBalance: 0,
  debtBalance: -500000,
  stockInvestment: 0,
  budgetLimit: 0,
  transactions: [],
  netWorthHistory: []
};

// Selected Date for calendar logging
let selectedDateStr = '';
let currentCalendarMonth = new Date().getMonth();
let currentCalendarYear = new Date().getFullYear();

// Chart Instances
let trendChartInstance = null;
let breakdownChartInstance = null;
let currentBreakdownTab = 'mix';

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  const today = new Date();
  const initDate = (today.getFullYear() === 2026) ? today : new Date('2026-07-15');
  
  currentCalendarMonth = initDate.getMonth();
  currentCalendarYear = initDate.getFullYear();
  selectedDateStr = formatDateString(initDate);

  // Sync Date Input Field
  document.getElementById('entry-date').value = selectedDateStr;

  // Setup Event Listeners
  setupEventListeners();

  // Load state from Neon Database
  loadData();
  
  // Initialize Lucide Icons
  lucide.createIcons();
});

// Load state from DB
async function loadData() {
  try {
    const res = await fetch('/api/state');
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Server returned ${res.status}: ${errText}`);
    }
    const dbState = await res.json();
    
    // Auto-sync any local offline transactions before writing database state
    await syncOfflineTransactions(dbState);
    
    state = dbState;
    
    // Sync forms
    document.getElementById('bank-balance').value = state.bankBalance;
    document.getElementById('debt-balance').value = state.debtBalance;
    document.getElementById('stock-investment').value = state.stockInvestment;
    document.getElementById('budget-limit').value = state.budgetLimit || '';

    // Render Page Elements
    updateUI();
  } catch (err) {
    console.error("Failed to load state from Neon DB, running local fallback", err);
    // Don't show annoying database offline alert on first boot if local fallback is present
    const local = localStorage.getItem('sams_wealth_local_fallback');
    if (local) {
      state = JSON.parse(local);
      updateUI();
    } else {
      alert("Database connection offline. Showing fallback interface. Error: " + err.message);
    }
  }
}

// Sync local offline transactions to database
async function syncOfflineTransactions(dbState) {
  const local = localStorage.getItem('sams_wealth_local_fallback');
  if (!local) return;
  
  try {
    const localState = JSON.parse(local);
    const dbTxIds = new Set(dbState.transactions.map(t => t.id));
    
    // Find transactions in local fallback that are missing from database
    const unsynced = localState.transactions.filter(t => !dbTxIds.has(t.id));
    
    if (unsynced.length > 0) {
      console.log(`Syncing ${unsynced.length} offline transactions to Neon DB...`);
      for (let t of unsynced) {
        await fetch('/api/transaction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(t)
        });
      }
      // Clear fallback local storage logs once uploaded
      localStorage.removeItem('sams_wealth_local_fallback');
    }
  } catch (e) {
    console.error("Failed to auto-sync offline data", e);
  }
}

// Save backup copy to local storage
function saveLocalFallback() {
  localStorage.setItem('sams_wealth_local_fallback', JSON.stringify(state));
}

// Setup Event Listeners
function setupEventListeners() {
  // Sync Date Input changes to selected Date Str & Calendar scroll position
  document.getElementById('entry-date').addEventListener('change', (e) => {
    const inputDateVal = e.target.value;
    if (!inputDateVal) return;
    
    selectedDateStr = inputDateVal;
    
    // Parse month/year from date to auto-scroll calendar if needed
    const parsedDate = new Date(inputDateVal);
    if (!isNaN(parsedDate.getTime())) {
      currentCalendarMonth = parsedDate.getMonth();
      currentCalendarYear = parsedDate.getFullYear();
    }
    
    updateUI();
  });

  // Bank & Debt Form Submission
  document.getElementById('bank-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const bankVal = parseFloat(document.getElementById('bank-balance').value) || 0;
    const debtVal = parseFloat(document.getElementById('debt-balance').value) || 0;
    const budgetVal = parseFloat(document.getElementById('budget-limit').value) || 0;
    
    try {
      const res = await fetch('/api/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankBalance: bankVal, debtBalance: debtVal, budgetLimit: budgetVal })
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText);
      }
      await loadData();
    } catch (err) {
      console.error('Failed to update portfolio on DB', err);
      alert('Failed to update portfolio on DB: ' + err.message);
      state.bankBalance = bankVal;
      state.debtBalance = debtVal;
      state.budgetLimit = budgetVal;
      saveLocalFallback();
      updateUI();
    }
  });

  // Stock Form Submission
  document.getElementById('stock-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const stockVal = parseFloat(document.getElementById('stock-investment').value) || 0;
    
    try {
      const res = await fetch('/api/stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockInvestment: stockVal })
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText);
      }
      await loadData();
    } catch (err) {
      console.error('Failed to update stock investment on DB', err);
      alert('Failed to update stocks on DB: ' + err.message);
      state.stockInvestment = stockVal;
      saveLocalFallback();
      updateUI();
    }
  });

  // Daily Log Form
  document.getElementById('daily-log-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = document.getElementById('entry-type').value;
    const amount = parseFloat(document.getElementById('entry-amount').value) || 0;
    const category = document.getElementById('entry-category').value;
    const description = document.getElementById('entry-desc').value.trim() || category; // Fallback to category if empty
    const autoAdjust = document.getElementById('auto-adjust-balance').checked;
    
    const dateVal = document.getElementById('entry-date').value;
    if (!dateVal) return;
    selectedDateStr = dateVal;

    const newLog = {
      id: Date.now().toString(),
      date: selectedDateStr,
      type: type,
      amount: amount,
      category: category,
      description: description,
      autoAdjusted: autoAdjust
    };

    try {
      const res = await fetch('/api/transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newLog)
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText);
      }
      await loadData();
      document.getElementById('entry-amount').value = '';
      document.getElementById('entry-desc').value = '';
    } catch (err) {
      console.error('Failed to save transaction on DB', err);
      alert('Saving locally (Offline Fallback): ' + err.message);
      state.transactions.push(newLog);
      if (autoAdjust) {
        if (type === 'gain') state.bankBalance += amount;
        else state.bankBalance -= amount;
      }
      saveLocalFallback();
      updateUI();
    }
  });

  // Export JSON backup
  document.getElementById('export-btn').addEventListener('click', () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `sams_networth_backup_${formatDateString(new Date())}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  });

  // Export CSV Ledger
  document.getElementById('export-csv-btn').addEventListener('click', () => {
    exportToCSV();
  });

  // Import Data JSON
  const fileInput = document.getElementById('import-file');
  document.getElementById('import-btn-trigger').addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const importedState = JSON.parse(evt.target.result);
        if (typeof importedState.bankBalance === 'number' && Array.isArray(importedState.transactions)) {
          state = importedState;
          
          await fetch('/api/portfolio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              bankBalance: state.bankBalance,
              debtBalance: state.debtBalance || -500000,
              budgetLimit: state.budgetLimit || 0
            })
          });

          await fetch('/api/stock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stockInvestment: state.stockInvestment })
          });

          for (let t of state.transactions) {
            await fetch('/api/transaction', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...t, autoAdjusted: false })
            });
          }

          await loadData();
          alert('Backup restored to database successfully!');
        } else {
          alert('Invalid backup file structure.');
        }
      } catch (err) {
        alert('Failed to restore backup file.');
      }
    };
    reader.readAsText(file);
  });

  // Calendar navigation
  document.getElementById('prev-month').addEventListener('click', () => {
    changeMonth(-1);
  });
  document.getElementById('next-month').addEventListener('click', () => {
    changeMonth(1);
  });

  // Chart Tab selectors
  document.getElementById('tab-mix').addEventListener('click', () => {
    toggleBreakdownTab('mix');
  });
  document.getElementById('tab-spend').addEventListener('click', () => {
    toggleBreakdownTab('spend');
  });
}

// Format date helper: YYYY-MM-DD
function formatDateString(date) {
  const d = new Date(date);
  let month = '' + (d.getMonth() + 1);
  let day = '' + d.getDate();
  const year = d.getFullYear();

  if (month.length < 2) month = '0' + month;
  if (day.length < 2) day = '0' + day;

  return [year, month, day].join('-');
}

// Record/update current date net worth history snapshot
function recordNetWorthSnapshot(currentNetWorth) {
  const todayStr = selectedDateStr || formatDateString(new Date());
  
  state.netWorthHistory = state.netWorthHistory.filter(h => h.date !== todayStr);
  state.netWorthHistory.push({
    date: todayStr,
    netWorth: currentNetWorth
  });
  state.netWorthHistory.sort((a, b) => new Date(a.date) - new Date(b.date));
  saveLocalFallback();
}

// Update complete interface
function updateUI() {
  const currentNetWorth = state.bankBalance + state.stockInvestment + state.debtBalance;
  
  // 1. Update Core Net Worth Stats
  document.getElementById('stat-net-worth').textContent = formatCurrency(currentNetWorth);

  // 2. Goal Calculations & Progress Bar
  const totalRange = GOAL_TARGET - GOAL_START; // 15L range
  const covered = currentNetWorth - GOAL_START;
  let percent = Math.floor((covered / totalRange) * 100);
  percent = Math.max(0, Math.min(100, percent));

  const fillElement = document.getElementById('progress-fill');
  const percentBubble = document.getElementById('progress-percent');
  fillElement.style.width = `${percent}%`;
  percentBubble.textContent = `${percent}%`;
  
  document.getElementById('progress-val-text').textContent = formatCurrency(currentNetWorth);

  // Milestone markers
  const markers = document.querySelectorAll('.milestone-marker');
  markers.forEach(m => m.classList.remove('active'));
  
  markers[0].classList.add('active'); // Always active (-5L start)
  if (currentNetWorth >= 0) markers[1].classList.add('active'); // Debt Free
  if (currentNetWorth >= 500000) markers[2].classList.add('active'); // Halfway
  if (currentNetWorth >= 1000000) markers[3].classList.add('active'); // Goal

  // Subtitle/Footer description for progress
  const targetRemaining = GOAL_TARGET - currentNetWorth;
  const targetRemText = document.getElementById('target-remaining');
  if (targetRemaining <= 0) {
    targetRemText.textContent = `Goal achieved! Surplus: ${formatCurrency(Math.abs(targetRemaining))}`;
    document.getElementById('progress-status-desc').textContent = "Excellent work! Target of 10 Lakhs Savings Achieved!";
  } else {
    targetRemText.textContent = `Target remaining: ${formatCurrency(targetRemaining)}`;
    document.getElementById('progress-status-desc').textContent = `Currently at ${percent}% of your financial goal milestone.`;
  }

  // 3. Date Counter Calculations
  const today = new Date();
  const timeDiff = TARGET_DATE - today;
  const daysRemaining = Math.max(0, Math.ceil(timeDiff / (1000 * 60 * 60 * 24)));
  document.getElementById('days-left').textContent = daysRemaining;

  // Required Savings Daily calculation
  const reqDailyText = document.getElementById('stat-daily-req');
  if (targetRemaining > 0 && daysRemaining > 0) {
    reqDailyText.textContent = formatCurrency(Math.ceil(targetRemaining / daysRemaining));
  } else {
    reqDailyText.textContent = '₹0';
  }

  // 4. Calculate Percentage Growth Change from Yesterday
  updateTrendIndicators(currentNetWorth);

  // 5. Streaks and Forecast Projections
  updateStreaks();
  updateProjections(currentNetWorth);

  // 6. Monthly Budget checks
  updateBudget();

  // 6b. Calculate calendar header statistics (Month Gains & Month Losses)
  updateCalendarHeaderStats();

  // 7. Update Calendar UI & selected date display
  renderCalendar();
  updateSelectedDateUI();

  // 8. Heatmap Renderer
  renderHeatmap();

  // 9. Update Charts
  renderTrendChart();
  renderBreakdownChart();
}

// Calculate monthly calendar stats dynamically for the active calendar month
function updateCalendarHeaderStats() {
  const monthlyGains = state.transactions
    .filter(t => {
      const dateParts = t.date.split('-');
      const tYear = parseInt(dateParts[0]);
      const tMonth = parseInt(dateParts[1]) - 1;
      return t.type === 'gain' && tYear === currentCalendarYear && tMonth === currentCalendarMonth;
    })
    .reduce((sum, t) => sum + t.amount, 0);

  const monthlyLosses = state.transactions
    .filter(t => {
      const dateParts = t.date.split('-');
      const tYear = parseInt(dateParts[0]);
      const tMonth = parseInt(dateParts[1]) - 1;
      return t.type === 'loss' && tYear === currentCalendarYear && tMonth === currentCalendarMonth;
    })
    .reduce((sum, t) => sum + t.amount, 0);

  document.getElementById('cal-month-gain').textContent = `₹${monthlyGains.toLocaleString('en-IN')}`;
  document.getElementById('cal-month-loss').textContent = `₹${monthlyLosses.toLocaleString('en-IN')}`;
}

// Calculate and render trend arrow + percentage
function updateTrendIndicators(currentNetWorth) {
  const trendHeader = document.getElementById('header-trend-indicator');
  const trendStatBox = document.getElementById('stat-daily-change');
  
  const sortedHistory = [...state.netWorthHistory].sort((a, b) => new Date(a.date) - new Date(b.date));
  
  let prevNetWorth = GOAL_START;
  
  if (sortedHistory.length >= 2) {
    const prevRecord = sortedHistory[sortedHistory.length - 2];
    prevNetWorth = prevRecord.netWorth;
  } else {
    // If only 1 entry, compare directly to baseline goal start
    prevNetWorth = GOAL_START;
  }

  if (prevNetWorth === 0) {
    trendHeader.className = 'header-trend-wrapper no-change';
    trendHeader.innerHTML = '<span>0.00%</span>';
    trendStatBox.textContent = '0.00%';
    trendStatBox.style.color = 'var(--text-muted)';
    return;
  }

  const changeVal = currentNetWorth - prevNetWorth;
  const changePercent = (changeVal / Math.abs(prevNetWorth)) * 100;

  if (changeVal > 0) {
    trendHeader.className = 'header-trend-wrapper up';
    trendHeader.innerHTML = `<i data-lucide="arrow-up-right" style="width: 14px; height: 14px;"></i><span>▲ ${changePercent.toFixed(2)}%</span>`;
    trendStatBox.textContent = `+${changePercent.toFixed(2)}%`;
    trendStatBox.style.color = 'var(--success-green)';
  } else if (changeVal < 0) {
    trendHeader.className = 'header-trend-wrapper down';
    trendHeader.innerHTML = `<i data-lucide="arrow-down-right" style="width: 14px; height: 14px;"></i><span>▼ ${Math.abs(changePercent).toFixed(2)}%</span>`;
    trendStatBox.textContent = `-${Math.abs(changePercent).toFixed(2)}%`;
    trendStatBox.style.color = 'var(--danger-red)';
  } else {
    trendHeader.className = 'header-trend-wrapper no-change';
    trendHeader.innerHTML = '<span>No Change</span>';
    trendStatBox.textContent = '0.00%';
    trendStatBox.style.color = 'var(--text-muted)';
  }
  lucide.createIcons();
}

// Calculate Saving Streaks
function updateStreaks() {
  const streakBox = document.getElementById('stat-streak');
  
  if (state.transactions.length === 0) {
    streakBox.textContent = '0 Days';
    return;
  }

  const dailyBalances = {};
  state.transactions.forEach(t => {
    if (!dailyBalances[t.date]) {
      dailyBalances[t.date] = 0;
    }
    if (t.type === 'gain') {
      dailyBalances[t.date] += t.amount;
    } else {
      dailyBalances[t.date] -= t.amount;
    }
  });

  const activeDates = Object.keys(dailyBalances).sort((a, b) => new Date(b) - new Date(a));
  
  let streak = 0;
  let checkDate = new Date();
  if (activeDates.length > 0 && new Date(activeDates[0]) > checkDate) {
    checkDate = new Date(activeDates[0]);
  }

  for (let i = 0; i < 365; i++) {
    const checkStr = formatDateString(checkDate);
    if (dailyBalances[checkStr] !== undefined) {
      if (dailyBalances[checkStr] >= 0) {
        streak++;
      } else {
        break;
      }
    }
    checkDate.setDate(checkDate.getDate() - 1);
  }

  streakBox.textContent = `${streak} Day${streak !== 1 ? 's' : ''}`;
}

// Calculate projected goal date
function updateProjections(currentNetWorth) {
  const projBox = document.getElementById('stat-projected-date');
  const sortedHistory = [...state.netWorthHistory].sort((a, b) => new Date(a.date) - new Date(b.date));
  
  if (sortedHistory.length < 2) {
    projBox.textContent = 'Need Data';
    return;
  }

  const firstRec = sortedHistory[0];
  const lastRec = sortedHistory[sortedHistory.length - 1];

  const firstDate = new Date(firstRec.date);
  const lastDate = new Date(lastRec.date);
  const timeDiff = lastDate - firstDate;
  const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

  if (daysDiff <= 0) {
    projBox.textContent = 'Need Data';
    return;
  }

  const netWorthDelta = lastRec.netWorth - firstRec.netWorth;
  const dailyVelocity = netWorthDelta / daysDiff;

  if (dailyVelocity <= 0) {
    projBox.textContent = 'No growth';
    return;
  }

  const remainingToGoal = GOAL_TARGET - currentNetWorth;
  if (remainingToGoal <= 0) {
    projBox.textContent = 'Goal Met!';
    return;
  }

  const daysToGoal = Math.ceil(remainingToGoal / dailyVelocity);
  const projectedDate = new Date();
  projectedDate.setDate(projectedDate.getDate() + daysToGoal);

  projBox.textContent = projectedDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// Monthly budget tracking
function updateBudget() {
  const container = document.getElementById('budget-progress-section');
  const fill = document.getElementById('budget-bar-fill');
  const label = document.getElementById('budget-used-text');

  if (!state.budgetLimit || state.budgetLimit <= 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';

  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;

  const monthlyExpenses = state.transactions
    .filter(t => {
      const d = new Date(t.date);
      return t.type === 'loss' && (d.getFullYear() === currentYear) && ((d.getMonth() + 1) === currentMonth);
    })
    .reduce((sum, t) => sum + t.amount, 0);

  let percent = (monthlyExpenses / state.budgetLimit) * 100;
  percent = Math.min(100, Math.max(0, percent));

  fill.style.width = `${percent}%`;
  label.textContent = `₹${monthlyExpenses.toLocaleString('en-IN')} / ₹${state.budgetLimit.toLocaleString('en-IN')}`;

  if (monthlyExpenses > state.budgetLimit) {
    fill.className = 'budget-bar-fill over-budget';
  } else {
    fill.className = 'budget-bar-fill';
  }
}

// Export CSV format
function exportToCSV() {
  if (state.transactions.length === 0) {
    alert('No transaction ledger data to export!');
    return;
  }

  let csvContent = 'data:text/csv;charset=utf-8,Date,Type,Amount (INR),Category,Description,AutoAdjusted\n';

  state.transactions.forEach(t => {
    const row = [
      t.date,
      t.type.toUpperCase(),
      t.amount,
      `"${t.category || 'Other'}"`,
      `"${t.description.replace(/"/g, '""')}"`,
      t.autoAdjusted ? 'YES' : 'NO'
    ].join(',');
    csvContent += row + '\n';
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `sams_financial_ledger_${formatDateString(new Date())}.csv`);
  document.body.appendChild(link);
  link.click();
  link.remove();
}

// Toggle Breakdown Tab
function toggleBreakdownTab(tab) {
  currentBreakdownTab = tab;
  document.getElementById('tab-mix').classList.toggle('active', tab === 'mix');
  document.getElementById('tab-spend').classList.toggle('active', tab === 'spend');
  renderBreakdownChart();
}

// Render Calendar Logic
function renderCalendar() {
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  document.getElementById('calendar-month-year').textContent = `${monthNames[currentCalendarMonth]} ${currentCalendarYear}`;
  updateCalendarHeaderStats();

  const daysGrid = document.getElementById('calendar-days-grid');
  daysGrid.innerHTML = '';

  const firstDayIndex = new Date(currentCalendarYear, currentCalendarMonth, 1).getDay();
  const lastDayDate = new Date(currentCalendarYear, currentCalendarMonth + 1, 0).getDate();

  for (let i = 0; i < firstDayIndex; i++) {
    const emptyCell = document.createElement('div');
    emptyCell.classList.add('calendar-day', 'empty-day');
    daysGrid.appendChild(emptyCell);
  }

  const todayStr = formatDateString(new Date());

  for (let day = 1; day <= lastDayDate; day++) {
    const dayCell = document.createElement('div');
    dayCell.classList.add('calendar-day');
    dayCell.textContent = day;

    const cellDateStr = formatDateString(new Date(currentCalendarYear, currentCalendarMonth, day));

    if (cellDateStr === selectedDateStr) {
      dayCell.classList.add('selected');
    }

    if (cellDateStr === todayStr) {
      dayCell.classList.add('today');
    }

    const dayTransactions = state.transactions.filter(t => t.date === cellDateStr);
    if (dayTransactions.length > 0) {
      const dotsContainer = document.createElement('div');
      dotsContainer.classList.add('day-dots');
      
      const hasGains = dayTransactions.some(t => t.type === 'gain');
      const hasLosses = dayTransactions.some(t => t.type === 'loss');

      if (hasGains) {
        const gDot = document.createElement('span');
        gDot.classList.add('dot', 'gain');
        dotsContainer.appendChild(gDot);
      }
      if (hasLosses) {
        const lDot = document.createElement('span');
        lDot.classList.add('dot', 'loss');
        dotsContainer.appendChild(lDot);
      }
      dayCell.appendChild(dotsContainer);
    }

    dayCell.addEventListener('click', () => {
      selectedDateStr = cellDateStr;
      
      // Sync Date input field when selecting cell
      document.getElementById('entry-date').value = selectedDateStr;

      const cells = daysGrid.querySelectorAll('.calendar-day');
      cells.forEach(c => c.classList.remove('selected'));
      dayCell.classList.add('selected');

      updateSelectedDateUI();
    });

    daysGrid.appendChild(dayCell);
  }
}

// Change month
function changeMonth(direction) {
  currentCalendarMonth += direction;
  if (currentCalendarMonth < 0) {
    currentCalendarMonth = 11;
    currentCalendarYear -= 1;
  } else if (currentCalendarMonth > 11) {
    currentCalendarMonth = 0;
    currentCalendarYear += 1;
  }
  renderCalendar();
}

// Update transaction lists
function updateSelectedDateUI() {
  if (!selectedDateStr) return;

  const dateObj = new Date(selectedDateStr);
  const readableDate = dateObj.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });

  document.getElementById('log-panel-title').innerHTML = `<i data-lucide="plus-circle" class="orange-text"></i> Log for ${dateObj.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}`;
  document.getElementById('selected-date-display').textContent = readableDate;
  lucide.createIcons();

  const logsList = document.getElementById('day-logs-list');
  logsList.innerHTML = '';

  const dayTransactions = state.transactions.filter(t => t.date === selectedDateStr);

  if (dayTransactions.length === 0) {
    logsList.innerHTML = '<li class="empty-log-msg">No logs for this date.</li>';
    return;
  }

  dayTransactions.forEach(t => {
    const li = document.createElement('li');
    li.classList.add('log-item');
    
    li.innerHTML = `
      <div class="log-item-details">
        <span class="log-item-desc">${t.description}</span>
        <span class="log-item-tag">${t.category || 'Other'} (${t.autoAdjusted ? 'Adjusted' : 'Manual'})</span>
      </div>
      <div class="log-item-amount ${t.type}">
        ${t.type === 'gain' ? '+' : '-'}₹${t.amount.toLocaleString('en-IN')}
        <button class="delete-log-btn" data-id="${t.id}" title="Delete Entry">&times;</button>
      </div>
    `;

    li.querySelector('.delete-log-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTransaction(t.id);
    });

    logsList.appendChild(li);
  });
}

// Delete Logged transaction
async function deleteTransaction(id) {
  try {
    const res = await fetch(`/api/transaction/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      // If the transaction is not found in database (e.g. was a temporary local-fallback item),
      // delete it locally anyway to prevent the UI from getting stuck
      if (res.status === 404) {
        state.transactions = state.transactions.filter(t => t.id !== id);
        saveLocalFallback();
        updateUI();
        return;
      }
      const errText = await res.text();
      throw new Error(errText);
    }
    await loadData();
  } catch (err) {
    console.error('Failed to delete transaction on DB', err);
    // Graceful client fallback deletion
    state.transactions = state.transactions.filter(t => t.id !== id);
    const currentNetWorth = state.bankBalance + state.stockInvestment + state.debtBalance;
    recordNetWorthSnapshot(currentNetWorth);
    saveLocalFallback();
    updateUI();
  }
}

// RENDER TREND CHART (Line Chart)
function renderTrendChart() {
  const ctx = document.getElementById('trendChart').getContext('2d');
  const sortedHistory = [...state.netWorthHistory].sort((a, b) => new Date(a.date) - new Date(b.date));
  
  const labels = sortedHistory.map(h => {
    const d = new Date(h.date);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });
  const dataPoints = sortedHistory.map(h => h.netWorth);

  const targetLineData = sortedHistory.map(() => GOAL_TARGET);
  const startLineData = sortedHistory.map(() => GOAL_START);

  if (trendChartInstance) {
    trendChartInstance.destroy();
  }

  trendChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Net Worth (₹)',
          data: dataPoints,
          borderColor: '#e05320',
          backgroundColor: 'rgba(224, 83, 32, 0.1)',
          fill: true,
          tension: 0.3,
          borderWidth: 3,
          pointBackgroundColor: '#e05320',
          pointHoverRadius: 6
        },
        {
          label: 'Savings Goal (+10L)',
          data: targetLineData,
          borderColor: '#10b981',
          borderDash: [5, 5],
          pointRadius: 0,
          borderWidth: 1.5,
          fill: false
        },
        {
          label: 'Debt Start (-5L)',
          data: startLineData,
          borderColor: '#ef4444',
          borderDash: [5, 5],
          pointRadius: 0,
          borderWidth: 1.5,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: '#a1a1aa',
            font: { family: 'Plus Jakarta Sans', size: 10 }
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              return context.dataset.label + ': ₹' + context.raw.toLocaleString('en-IN');
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#71717a', font: { family: 'Plus Jakarta Sans', size: 9 } }
        },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: {
            color: '#71717a',
            font: { family: 'Plus Jakarta Sans', size: 9 },
            callback: function(value) {
              if (Math.abs(value) >= 100000) {
                return (value / 100000).toFixed(1) + 'L';
              }
              return value.toLocaleString('en-IN');
            }
          }
        }
      }
    }
  });
}

// RENDER BREAKDOWN CHART
function renderBreakdownChart() {
  const ctx = document.getElementById('breakdownChart').getContext('2d');

  if (breakdownChartInstance) {
    breakdownChartInstance.destroy();
  }

  let labels = [];
  let data = [];
  let bgColors = [];

  if (currentBreakdownTab === 'mix') {
    const bankVal = state.bankBalance;
    const stockVal = state.stockInvestment;
    const debtVal = Math.abs(state.debtBalance);
    
    labels = ['Cash / Bank Balance', 'Stock Investments', 'Outstanding Debt'];
    data = [bankVal, stockVal, debtVal];
    bgColors = ['#3b82f6', '#e05320', '#ef4444'];
  } else {
    const categoriesMap = {};
    
    state.transactions
      .filter(t => t.type === 'loss')
      .forEach(t => {
        const cat = t.category || 'Other';
        categoriesMap[cat] = (categoriesMap[cat] || 0) + t.amount;
      });

    labels = Object.keys(categoriesMap);
    data = Object.values(categoriesMap);
    
    bgColors = labels.map((_, index) => {
      const shades = ['#e05320', '#f97316', '#fb923c', '#fdba74', '#fed7aa', '#ffedd5', '#b45309', '#78350f'];
      return shades[index % shades.length];
    });

    if (labels.length === 0) {
      labels = ['No Expenses logged'];
      data = [1];
      bgColors = ['#1a1a20'];
    }
  }

  breakdownChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: bgColors,
        borderWidth: 2,
        borderColor: '#141417'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#a1a1aa',
            font: { family: 'Plus Jakarta Sans', size: 9 },
            boxWidth: 10
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              if (context.label.includes('No Expenses')) return context.label;
              return context.label + ': ₹' + context.raw.toLocaleString('en-IN');
            }
          }
        }
      }
    }
  });
}

// RENDER HEATMAP
function renderHeatmap() {
  const grid = document.getElementById('heatmap-grid');
  if (!grid) return;
  
  grid.innerHTML = '';

  const dailyBalances = {};
  state.transactions.forEach(t => {
    if (!dailyBalances[t.date]) {
      dailyBalances[t.date] = 0;
    }
    if (t.type === 'gain') {
      dailyBalances[t.date] += t.amount;
    } else {
      dailyBalances[t.date] -= t.amount;
    }
  });

  const cellsCount = 168;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - cellsCount + 1);

  const startDay = startDate.getDay();
  startDate.setDate(startDate.getDate() - startDay);

  for (let i = 0; i < cellsCount + startDay; i++) {
    const currentCellDate = new Date(startDate);
    currentCellDate.setDate(currentCellDate.getDate() + i);

    const cellStr = formatDateString(currentCellDate);
    const cellValue = dailyBalances[cellStr] || 0;

    const cell = document.createElement('div');
    cell.classList.add('heatmap-cell');
    
    const dayLabel = currentCellDate.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
    let valueLabel = 'No activities logged';
    if (cellValue > 0) {
      valueLabel = `+₹${cellValue.toLocaleString('en-IN')}`;
      if (cellValue < 5000) cell.classList.add('gain-low');
      else if (cellValue < 25000) cell.classList.add('gain-med');
      else cell.classList.add('gain-high');
    } else if (cellValue < 0) {
      valueLabel = `-₹${Math.abs(cellValue).toLocaleString('en-IN')}`;
      if (Math.abs(cellValue) < 5000) cell.classList.add('loss-low');
      else if (Math.abs(cellValue) < 15000) cell.classList.add('loss-med');
      else cell.classList.add('loss-high');
    }
    
    cell.setAttribute('data-tooltip', `${dayLabel}: ${valueLabel}`);
    grid.appendChild(cell);
  }
}

// Currency Formatter
function formatCurrency(num) {
  const isNeg = num < 0;
  const absNum = Math.abs(num);
  
  let formatted = '';
  if (absNum >= 100000) {
    formatted = (absNum / 100000).toFixed(2) + ' Lakhs';
  } else {
    formatted = absNum.toLocaleString('en-IN');
  }

  return (isNeg ? '-' : '') + '₹' + formatted;
}
