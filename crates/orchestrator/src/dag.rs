//! Typed Goal DAG with total validation and deterministic scheduling
//! (ADR-016).

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::judgment::EvidenceSpec;

/// One task node in the goal DAG.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct TaskNode {
    /// Stable task identifier.
    pub task_id: String,
    /// Dependency task ids that must be evidence-complete first.
    pub dependencies: Vec<String>,
    /// Acceptance evidence a completion report must match exactly.
    pub declared_evidence: Vec<EvidenceSpec>,
}

/// DAG failures with stable codes.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DagError {
    /// A dependency names an unknown task.
    UnknownDependency,
    /// The graph contains a cycle.
    Cycle,
    /// A task id was malformed or duplicated.
    Malformed,
}

impl std::fmt::Display for DagError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::UnknownDependency => "unknown_dependency",
            Self::Cycle => "cycle",
            Self::Malformed => "malformed",
        })
    }
}

impl std::error::Error for DagError {}

/// The typed goal graph.
#[derive(Clone, Debug, Default, Serialize)]
pub struct GoalDag {
    goal_id: String,
    tasks: BTreeMap<String, TaskNode>,
}

impl GoalDag {
    /// Construct and totally validate the DAG.
    ///
    /// # Errors
    ///
    /// [`DagError::Malformed`] for empty/duplicate ids;
    /// [`DagError::UnknownDependency`] for dangling references;
    /// [`DagError::Cycle`] for cyclic graphs.
    pub fn new(goal_id: &str, tasks: Vec<TaskNode>) -> Result<Self, DagError> {
        if goal_id.is_empty() {
            return Err(DagError::Malformed);
        }
        let mut map = BTreeMap::new();
        for task in tasks {
            if task.task_id.is_empty() || map.contains_key(&task.task_id) {
                return Err(DagError::Malformed);
            }
            map.insert(task.task_id.clone(), task);
        }
        let dag = Self {
            goal_id: goal_id.to_owned(),
            tasks: map,
        };
        dag.validate()?;
        Ok(dag)
    }

    fn validate(&self) -> Result<(), DagError> {
        for task in self.tasks.values() {
            for dependency in &task.dependencies {
                if !self.tasks.contains_key(dependency) {
                    return Err(DagError::UnknownDependency);
                }
            }
        }
        // DFS cycle detection with a tri-color marking.
        let mut visiting = BTreeSet::new();
        let mut done = BTreeSet::new();
        for task_id in self.tasks.keys() {
            self.visit(task_id, &mut visiting, &mut done)?;
        }
        Ok(())
    }

    fn visit(
        &self,
        task_id: &str,
        visiting: &mut BTreeSet<String>,
        done: &mut BTreeSet<String>,
    ) -> Result<(), DagError> {
        if done.contains(task_id) {
            return Ok(());
        }
        if !visiting.insert(task_id.to_owned()) {
            return Err(DagError::Cycle);
        }
        if let Some(task) = self.tasks.get(task_id) {
            for dependency in &task.dependencies {
                self.visit(dependency, visiting, done)?;
            }
        }
        visiting.remove(task_id);
        done.insert(task_id.to_owned());
        Ok(())
    }

    /// The owning goal.
    #[must_use]
    pub fn goal_id(&self) -> &str {
        &self.goal_id
    }

    /// One task node.
    #[must_use]
    pub fn task(&self, task_id: &str) -> Option<&TaskNode> {
        self.tasks.get(task_id)
    }

    /// All task ids, sorted.
    pub fn task_ids(&self) -> impl Iterator<Item = &str> {
        self.tasks.keys().map(String::as_str)
    }

    /// Tasks whose dependencies are all evidence-complete, in
    /// deterministic (sorted) order. A task cannot run before its
    /// dependencies — there is no other starting path.
    #[must_use]
    pub fn ready_tasks(&self, completed: &BTreeSet<String>) -> Vec<&TaskNode> {
        let mut ready: Vec<&TaskNode> = self
            .tasks
            .values()
            .filter(|task| {
                task.dependencies
                    .iter()
                    .all(|dependency| completed.contains(dependency))
            })
            .collect();
        ready.sort_by(|left, right| left.task_id.cmp(&right.task_id));
        ready
    }

    /// Transitive descendants of one task (cancellation blast radius).
    #[must_use]
    pub fn descendants(&self, task_id: &str) -> BTreeSet<String> {
        let mut found = BTreeSet::new();
        let mut frontier = vec![task_id.to_owned()];
        while let Some(current) = frontier.pop() {
            for task in self.tasks.values() {
                if task
                    .dependencies
                    .iter()
                    .any(|dependency| dependency == &current)
                    && found.insert(task.task_id.clone())
                {
                    frontier.push(task.task_id.clone());
                }
            }
        }
        found
    }
}

/// Live task state within the orchestrator.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskState {
    /// Waiting for dependencies.
    Pending,
    /// A delegation is in flight.
    Delegated,
    /// Completed with verified evidence.
    Completed,
    /// Terminally failed (budget, retries exhausted or rejection).
    Failed,
    /// Cancelled with its descendants.
    Cancelled,
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
    use super::*;

    fn node(id: &str, deps: &[&str]) -> TaskNode {
        TaskNode {
            task_id: id.to_owned(),
            dependencies: deps.iter().map(ToString::to_string).collect(),
            declared_evidence: Vec::new(),
        }
    }

    #[test]
    fn cycles_and_unknown_dependencies_are_rejected() {
        assert_eq!(
            GoalDag::new("goal_01", vec![node("a", &["b"]), node("b", &["a"])]).unwrap_err(),
            DagError::Cycle
        );
        assert_eq!(
            GoalDag::new("goal_01", vec![node("a", &["missing"])]).unwrap_err(),
            DagError::UnknownDependency
        );
        assert_eq!(
            GoalDag::new("goal_01", vec![node("", &[])]).unwrap_err(),
            DagError::Malformed
        );
        assert!(GoalDag::new("goal_01", vec![node("a", &[]), node("b", &["a"])]).is_ok());
    }

    #[test]
    fn ready_order_is_deterministic_and_dependency_enforced() {
        let dag = GoalDag::new(
            "goal_01",
            vec![
                node("z_root", &[]),
                node("a_mid", &["z_root"]),
                node("b_mid", &["z_root"]),
            ],
        )
        .unwrap();
        let first: Vec<&str> = dag
            .ready_tasks(&BTreeSet::new())
            .iter()
            .map(|t| t.task_id.as_str())
            .collect();
        assert_eq!(first, vec!["z_root"]);
        let completed: BTreeSet<String> = ["z_root".to_owned()].into_iter().collect();
        let second: Vec<&str> = dag
            .ready_tasks(&completed)
            .iter()
            .map(|t| t.task_id.as_str())
            .collect();
        // Deterministic sorted order among simultaneously ready tasks
        // (z_root stays DAG-ready; terminal filtering is the scheduler's).
        assert_eq!(second, vec!["a_mid", "b_mid", "z_root"]);
        // Descendants for cancellation.
        let descendants = dag.descendants("z_root");
        assert_eq!(
            descendants,
            ["a_mid".to_owned(), "b_mid".to_owned()]
                .into_iter()
                .collect()
        );
    }
}
